import { createHash } from "node:crypto";
import type pg from "pg";
import { HttpError } from "../errors.js";
import { storage } from "../storage/index.js";
import { caseFileKey } from "../storage/keys.js";
import { requireFeature } from "./plans.js";
import type { LegalFramework } from "./channel.js";
import { type Tenant, tenantPool } from "./tenants.js";

/**
 * Evidencias que el denunciante adjunta desde el seguimiento. Se guardan en el almacenamiento privado de la empresa
 * (<empresa>/denuncias/<ley>/<código>/…) y solo se entregan a través del backend, que valida el rol y el caso.
 */

export const FILE_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxFiles: 20,
  maxTotalBytes: 100 * 1024 * 1024,
};

/** Estados en que el denunciante puede adjuntar: desde que la denuncia pasó a revisión y hasta su cierre. */
const UPLOAD_STATUSES = new Set(["in_review", "investigating", "resolution", "follow_up"]);
export const canUploadIn = (status: string) => UPLOAD_STATUSES.has(status);

const startsWith = (b: Buffer, bytes: number[], offset = 0) => bytes.every((x, i) => b[offset + i] === x);
const ascii = (b: Buffer, start: number, end: number) => b.subarray(start, end).toString("latin1");

// Contenedores ISO (fotos HEIC de iPhone, videos y audios): «ftyp» en el byte 4.
const isFtyp = (b: Buffer) => ascii(b, 4, 8) === "ftyp";
const isZip = (b: Buffer) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]);

/**
 * Tipos admitidos por extensión. El contenido debe coincidir con el formato (firma de los primeros bytes): no basta
 * con renombrar un archivo. Quedan fuera los ejecutables, HTML, SVG y cualquier formato que pueda ejecutar código.
 */
const FILE_TYPES: Record<string, { mime: string; matches: (b: Buffer) => boolean }> = {
  pdf: { mime: "application/pdf", matches: (b) => ascii(b, 0, 5) === "%PDF-" },
  jpg: { mime: "image/jpeg", matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  jpeg: { mime: "image/jpeg", matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  png: { mime: "image/png", matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  webp: { mime: "image/webp", matches: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP" },
  heic: { mime: "image/heic", matches: isFtyp },
  heif: { mime: "image/heif", matches: isFtyp },
  mp4: { mime: "video/mp4", matches: isFtyp },
  mov: { mime: "video/quicktime", matches: isFtyp },
  m4a: { mime: "audio/mp4", matches: isFtyp },
  mp3: {
    mime: "audio/mpeg",
    matches: (b) => ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0),
  },
  ogg: { mime: "audio/ogg", matches: (b) => ascii(b, 0, 4) === "OggS" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", matches: isZip },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", matches: isZip },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", matches: isZip },
};

export const ALLOWED_EXTENSIONS = Object.keys(FILE_TYPES);

function detectType(fileName: string, body: Buffer): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const type = FILE_TYPES[ext];
  if (!type || !fileName.includes(".")) {
    throw new HttpError(415, `Formato no admitido. Puedes adjuntar: ${ALLOWED_EXTENSIONS.join(", ")}.`);
  }
  if (body.length < 12 || !type.matches(body)) {
    throw new HttpError(415, `El archivo no es un .${ext} válido o está dañado.`);
  }
  return type.mime;
}

/** Nombre para mostrar: sin rutas ni caracteres de control, con un largo razonable. */
function cleanDisplayName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(-150);
  if (!clean) throw new HttpError(400, "El archivo no tiene nombre.");
  return clean;
}

export interface CaseFileRow {
  id: string;
  case_id: string;
  sender: "reporter" | "staff";
  file_name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  storage_key: string;
  created_at: Date;
}

export async function listCaseFiles(db: pg.Pool | pg.PoolClient, caseId: string): Promise<CaseFileRow[]> {
  return (await db.query<CaseFileRow>("SELECT * FROM case_files WHERE case_id = $1 ORDER BY created_at, id", [caseId])).rows;
}

/**
 * Guarda un archivo del denunciante. La denuncia se bloquea (FOR UPDATE) para que dos subidas simultáneas no
 * superen los límites. Si el registro falla, el archivo ya subido se borra para no dejar huérfanos.
 */
export async function addReporterFile(tenant: Tenant, caseId: string, rawName: string, body: Buffer): Promise<void> {
  if (!body.length) throw new HttpError(400, "El archivo está vacío.");
  if (body.length > FILE_LIMITS.maxBytes) throw new HttpError(413, "El archivo supera el máximo de 10 MB.");
  await requireFeature(tenant, "evidence");
  const fileName = cleanDisplayName(rawName);
  const mime = detectType(fileName, body);

  const db = await tenantPool(tenant).connect();
  let key: string | null = null;
  try {
    await db.query("BEGIN");
    const c = (
      await db.query<{ id: string; code: string; status: string; legal_framework: LegalFramework }>(
        `SELECT cs.id, cs.code, cs.status, cat.legal_framework
           FROM cases cs JOIN categories cat ON cat.id = cs.category_id
          WHERE cs.id = $1 FOR UPDATE OF cs`,
        [caseId],
      )
    ).rows[0];
    if (!c) throw new HttpError(401, "Tu sesión expiró. Vuelve a ingresar.");
    if (c.status === "closed") throw new HttpError(409, "La denuncia está cerrada y ya no recibe archivos.");
    if (!canUploadIn(c.status)) {
      throw new HttpError(409, "Podrás adjuntar archivos cuando el equipo haya comenzado a revisar tu denuncia.");
    }
    const usage = (
      await db.query<{ n: number; bytes: string }>(
        "SELECT count(*)::int AS n, COALESCE(sum(size_bytes), 0) AS bytes FROM case_files WHERE case_id = $1",
        [c.id],
      )
    ).rows[0]!;
    if (usage.n >= FILE_LIMITS.maxFiles) throw new HttpError(409, `Ya adjuntaste el máximo de ${FILE_LIMITS.maxFiles} archivos.`);
    if (Number(usage.bytes) + body.length > FILE_LIMITS.maxTotalBytes) {
      throw new HttpError(409, "Se alcanzó el espacio máximo de 100 MB para los archivos de esta denuncia.");
    }

    key = caseFileKey(tenant.slug, c.legal_framework, c.code, fileName);
    await storage.put(key, body, mime);
    await db.query(
      `INSERT INTO case_files (case_id, sender, file_name, mime, size_bytes, sha256, storage_key)
       VALUES ($1, 'reporter', $2, $3, $4, $5, $6)`,
      [c.id, fileName, mime, body.length, createHash("sha256").update(body).digest("hex"), key],
    );
    // Solo el nombre en la bitácora: el auditor la ve sin detalle.
    await db.query(
      "INSERT INTO case_events (case_id, actor_label, action, detail, kind) VALUES ($1, 'Denunciante', 'Archivo adjuntado por el denunciante', $2, 'evidence')",
      [c.id, fileName],
    );
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK").catch(() => undefined);
    if (key) await storage.remove(key).catch(() => undefined);
    throw err;
  } finally {
    db.release();
  }
}

/** Contenido de un archivo. Quien llama debe haber validado antes el acceso a la denuncia. */
export async function readCaseFile(tenant: Tenant, caseId: string, fileId: string) {
  const f = (
    await tenantPool(tenant).query<CaseFileRow>("SELECT * FROM case_files WHERE id = $1 AND case_id = $2", [fileId, caseId])
  ).rows[0];
  if (!f) throw new HttpError(404, "Archivo no encontrado");
  const body = await storage.get(f.storage_key);
  if (!body) throw new HttpError(404, "El archivo ya no está disponible en el almacenamiento.");
  return { file: f, body };
}

/** Borra del almacenamiento los archivos de las denuncias indicadas (antes de eliminarlas de la base). */
export async function removeFilesOfCases(db: pg.Pool | pg.PoolClient, caseIds: string[]): Promise<void> {
  if (!caseIds.length) return;
  const keys = (
    await db.query<{ storage_key: string }>("SELECT storage_key FROM case_files WHERE case_id = ANY($1::uuid[])", [caseIds])
  ).rows;
  for (const { storage_key } of keys) await storage.remove(storage_key).catch(() => undefined);
}
