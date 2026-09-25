import { createGunzip, createGzip } from "node:zlib";
import { Readable } from "node:stream";
import { buffer as streamToBuffer } from "node:stream/consumers";
import type pg from "pg";
import { config } from "../config.js";
import { globalPool } from "../db/pool.js";
import { storage } from "../storage/index.js";

/**
 * Mantenimiento de la auditoría (tabla particionada por mes en la base global):
 *   1. Crea con anticipación las particiones de los próximos meses.
 *   2. Archiva los meses más antiguos que AUDIT_HOT_MONTHS: los exporta comprimidos (JSON por línea + gzip) al
 *      almacenamiento de archivos —carpeta local hoy, S3 en producción— en plataforma/auditoria/AAAA/AAAA-MM-<fecha>.jsonl.gz,
 *      verifica el archivo y solo entonces elimina la partición de la base.
 * Corre al arrancar y una vez al día. Es seguro repetirlo.
 */

const PARTITION = /^audit_events_y(\d{4})m(\d{2})$/;
const BATCH = 5000;

const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const partitionName = (d: Date) => `audit_events_y${d.getUTCFullYear()}m${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
/** Cada archivo lleva la fecha en que se generó, para que nunca se sobrescriba uno anterior. */
export const archiveKey = (d: Date, at = new Date()) =>
  `plataforma/auditoria/${d.getUTCFullYear()}/${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${at
    .toISOString()
    .replace(/[-:]/g, "")
    .slice(0, 15)}.jsonl.gz`;

async function listPartitions(db: pg.Pool | pg.PoolClient): Promise<{ name: string; month: Date }[]> {
  const res = await db.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = 'audit_events'::regclass`,
  );
  return res.rows
    .map((r) => ({ name: r.name, m: PARTITION.exec(r.name) }))
    .filter((r): r is { name: string; m: RegExpExecArray } => r.m !== null)
    .map((r) => ({ name: r.name, month: new Date(Date.UTC(Number(r.m[1]), Number(r.m[2]) - 1, 1)) }))
    .sort((a, b) => a.month.getTime() - b.month.getTime());
}

/** Crea la partición de un mes. Si por algún motivo ya había eventos de ese mes en la de respaldo, los mueve. */
async function createPartition(month: Date): Promise<void> {
  const from = iso(month);
  const to = iso(addMonths(month, 1));
  const name = partitionName(month);
  const client = await globalPool.connect();
  try {
    await client.query("BEGIN");
    const stray = await client.query("SELECT 1 FROM audit_events_default WHERE occurred_at >= $1 AND occurred_at < $2 LIMIT 1", [from, to]);
    if (stray.rowCount) {
      await client.query("ALTER TABLE audit_events DETACH PARTITION audit_events_default");
      await client.query(`CREATE TABLE ${name} PARTITION OF audit_events FOR VALUES FROM ('${from}') TO ('${to}')`);
      await client.query(`INSERT INTO audit_events SELECT * FROM audit_events_default WHERE occurred_at >= $1 AND occurred_at < $2`, [from, to]);
      await client.query("DELETE FROM audit_events_default WHERE occurred_at >= $1 AND occurred_at < $2", [from, to]);
      await client.query("ALTER TABLE audit_events ATTACH PARTITION audit_events_default DEFAULT");
    } else {
      await client.query(`CREATE TABLE ${name} PARTITION OF audit_events FOR VALUES FROM ('${from}') TO ('${to}')`);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Asegura las particiones desde el mes actual hasta `ahead` meses adelante. */
export async function ensurePartitions(now = new Date(), ahead = 2): Promise<string[]> {
  const existing = new Set((await listPartitions(globalPool)).map((p) => p.name));
  const created: string[] = [];
  for (let i = 0; i <= ahead; i++) {
    const month = addMonths(monthStart(now), i);
    if (!existing.has(partitionName(month))) {
      await createPartition(month);
      created.push(partitionName(month));
    }
  }
  return created;
}

/** Exporta un mes a gzip, lo verifica leyéndolo de vuelta y elimina la partición. */
async function archivePartition(name: string, month: Date): Promise<{ events: number; bytes: number; key: string }> {
  // Lectura por lotes (por id) para no cargar el mes completo en memoria.
  const gzip = createGzip({ level: 9 });
  const compressed = streamToBuffer(gzip);
  let events = 0;
  let lastId = "0";
  for (;;) {
    const batch = await globalPool.query<{ id: string }>(`SELECT * FROM ${name} WHERE id > $1 ORDER BY id LIMIT ${BATCH}`, [lastId]);
    if (!batch.rows.length) break;
    gzip.write(batch.rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    events += batch.rows.length;
    lastId = batch.rows.at(-1)!.id;
  }
  gzip.end();
  const body = await compressed;

  const key = archiveKey(month);
  await storage.put(key, body, "application/gzip");

  // Verificación: el archivo guardado debe tener exactamente los mismos eventos.
  const stored = await storage.get(key);
  if (!stored) throw new Error(`No se pudo leer ${key} después de guardarlo`);
  const text = (await streamToBuffer(Readable.from(stored).pipe(createGunzip()))).toString("utf8");
  const lines = text ? text.trimEnd().split("\n").length : 0;
  if (lines !== events) throw new Error(`Archivo ${key} incompleto: ${lines} de ${events} eventos`);

  const client = await globalPool.connect();
  try {
    await client.query("BEGIN");
    // Por si llegaron eventos rezagados mientras se exportaba (no debería pasar en meses cerrados).
    const now = await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${name}`);
    if (Number(now.rows[0]!.n) !== events) throw new Error(`El mes ${name} cambió durante el archivo; se reintentará`);
    await client.query(
      "INSERT INTO audit_archives (month, storage_key, events, bytes) VALUES ($1, $2, $3, $4)",
      [iso(month), key, events, body.length],
    );
    await client.query(`DROP TABLE ${name}`);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return { events, bytes: body.length, key };
}

/** Archiva los meses anteriores a los últimos `hotMonths` (el mes actual cuenta como uno). */
export async function archiveOldPartitions(now = new Date(), hotMonths = config.audit.hotMonths) {
  const cutoff = addMonths(monthStart(now), -(hotMonths - 1));
  const done: { month: string; events: number; bytes: number }[] = [];
  // Si quedaron eventos antiguos en la partición de respaldo, primero se crea su mes (los mueve) para archivarlos.
  const strays = await globalPool.query<{ month: Date }>(
    "SELECT DISTINCT date_trunc('month', occurred_at AT TIME ZONE 'UTC') AS month FROM audit_events_default WHERE occurred_at < $1",
    [iso(cutoff)],
  );
  for (const r of strays.rows) await createPartition(monthStart(new Date(r.month)));
  for (const p of await listPartitions(globalPool)) {
    if (p.month >= cutoff) continue;
    const r = await archivePartition(p.name, p.month);
    done.push({ month: iso(p.month).slice(0, 7), events: r.events, bytes: r.bytes });
    console.log(`[auditoría] ${iso(p.month).slice(0, 7)} archivado en ${r.key} (${r.events} eventos, ${r.bytes} bytes)`);
  }
  return done;
}

export async function maintainAuditLog(now = new Date()): Promise<void> {
  const created = await ensurePartitions(now);
  if (created.length) console.log(`[auditoría] meses preparados: ${created.join(", ")}`);
  await archiveOldPartitions(now);
}

/** Estado para la consola: cuánto hay en la base y qué se archivó. */
export async function auditStorageStatus() {
  const [hot, archives] = await Promise.all([
    globalPool.query<{ events: string; bytes: string; oldest: Date | null }>(
      `SELECT count(*) AS events, pg_total_relation_size('audit_events_default')
         + COALESCE((SELECT sum(pg_total_relation_size(i.inhrelid)) FROM pg_inherits i
                     WHERE i.inhparent = 'audit_events'::regclass), 0) AS bytes,
         min(occurred_at) AS oldest
       FROM audit_events`,
    ),
    globalPool.query<{ month: Date; storage_key: string; events: string; bytes: string; archived_at: Date }>(
      "SELECT * FROM audit_archives ORDER BY month DESC, archived_at DESC",
    ),
  ]);
  return {
    hotMonths: config.audit.hotMonths,
    database: { events: Number(hot.rows[0]!.events), bytes: Number(hot.rows[0]!.bytes), oldest: hot.rows[0]!.oldest },
    archives: archives.rows.map((a) => ({
      month: iso(new Date(a.month)).slice(0, 7),
      key: a.storage_key,
      events: Number(a.events),
      bytes: Number(a.bytes),
      archivedAt: a.archived_at,
    })),
  };
}
