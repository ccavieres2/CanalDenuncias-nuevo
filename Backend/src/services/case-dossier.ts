import PDFDocument from "pdfkit";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { readCaseFile } from "./case-files.js";
import { type CaseRole, applyCaseAction, getVisibleCase } from "./cases.js";
import { sendMail } from "./mail.js";
import type { Tenant } from "./tenants.js";

/**
 * Expediente de una denuncia en PDF: datos, relato, personas, plazos, trazabilidad, mensajes y evidencias (con su
 * huella SHA-256 para acreditar su integridad). Sirve para remitir la denuncia a la Dirección del Trabajo, por
 * correo desde el canal o a mano (descargándolo y subiéndolo al portal de la DT).
 */

/** Hitos de Ley Karin que consisten en remitir antecedentes a la DT. */
export const DT_SEND_KEYS = ["dt_start_notice", "dt_report", "dt_referral"] as const;

// Las evidencias van adjuntas mientras quepan en un correo; si no, el PDF las lista con su huella.
const MAX_ATTACHMENTS_BYTES = 15 * 1024 * 1024;

const STATUS_LABEL: Record<string, string> = {
  received: "Recibida",
  review: "En revisión",
  investigating: "En investigación",
  resolution: "Por resolver",
  follow_up: "En seguimiento",
  closed: "Cerrada",
};

const FRAMEWORK_LABEL: Record<string, string> = {
  ley_karin: "Ley Karin (Ley 21.643)",
  ley_20393: "Delitos (Ley 20.393)",
  ley_21719: "Datos personales (Ley 21.719)",
  internal: "Normativa interna",
};

const dateFmt = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", dateStyle: "long" });
const dateTimeFmt = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", dateStyle: "medium", timeStyle: "short" });
const fmtDate = (d: Date | string | null | undefined) => (d ? dateFmt.format(new Date(d)) : "—");
const fmtDateTime = (d: Date | string | null | undefined) => (d ? dateTimeFmt.format(new Date(d)) : "—");
const fmtSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

type CaseView = Awaited<ReturnType<typeof getVisibleCase>>;

function render(tenant: Tenant, data: CaseView, generatedBy: string): Promise<Buffer> {
  const c = data.case;
  const doc = new PDFDocument({ size: "LETTER", margin: 56, bufferPages: true, info: { Title: `Expediente ${c.code}`, Author: tenant.legal_name ?? tenant.name } });
  const chunks: Buffer[] = [];
  doc.on("data", (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const heading = (text: string) => {
    doc.moveDown(1).font("Helvetica-Bold").fontSize(12).fillColor("#111827").text(text);
    doc.moveTo(doc.page.margins.left, doc.y + 2).lineTo(doc.page.width - doc.page.margins.right, doc.y + 2).strokeColor("#d1d5db").stroke();
    doc.moveDown(0.5).font("Helvetica").fontSize(10).fillColor("#1f2937");
  };
  const field = (label: string, value: string | null | undefined) => {
    if (!value) return;
    doc.font("Helvetica-Bold").text(`${label}: `, { continued: true }).font("Helvetica").text(value);
  };
  const paragraph = (text: string | null | undefined) => {
    if (text) doc.font("Helvetica").text(text, { align: "left" }).moveDown(0.3);
  };

  // Portada
  doc.font("Helvetica-Bold").fontSize(16).text(`Expediente de denuncia ${c.code}`);
  doc.font("Helvetica").fontSize(10).fillColor("#4b5563");
  doc.text(`${tenant.legal_name ?? tenant.name}${tenant.tax_id ? ` · RUT ${tenant.tax_id}` : ""}`);
  doc.text(`Generado el ${fmtDateTime(new Date())} por ${generatedBy} desde el canal de denuncias.`);
  doc.text("Documento reservado: contiene datos personales y, posiblemente, datos sensibles (Ley 21.719).");

  heading("1. Datos de la denuncia");
  field("Materia", FRAMEWORK_LABEL[c.category.framework] ?? c.category.framework);
  field("Categoría", c.category.name);
  field("Estado", STATUS_LABEL[c.status] ?? c.status);
  field("Recibida", fmtDateTime(c.receivedAt));
  field("Investiga", c.route === "dt" ? "Dirección del Trabajo" : c.route === "internal" ? "La empresa (investigación interna)" : null);
  field("Investigador asignado", c.investigator?.name);
  field("El denunciante pidió que investigue la DT", c.reporterRequestsDt ? "Sí" : null);
  field("Pidió protección urgente", c.urgentProtection ? "Sí" : null);
  field("Medidas a la autoridad", c.authorityNotifiedAt ? `Aviso registrado el ${fmtDate(c.authorityNotifiedAt)}` : null);

  heading("2. Denunciante y persona afectada");
  if (c.reporter) {
    field("Nombre", c.reporter.name);
    field("RUT", c.reporter.rut);
    field("Correo", c.reporter.email);
    field("Teléfono", c.reporter.phone);
  } else paragraph("Denuncia anónima.");
  field("Relación con la empresa", c.reporterRelation);
  if (c.affected) {
    doc.moveDown(0.3);
    field("Persona afectada", c.affected.name);
    field("RUT", c.affected.rut);
    field("Correo", c.affected.email);
    field("Representación", c.affected.representation);
  }

  heading("3. Hechos denunciados");
  field("Asunto", c.subject);
  field("Cuándo", c.occurredWhen);
  field("Dónde", c.occurredWhere);
  field("Relación con la persona denunciada", c.offenderRelation);
  field("Los hechos continúan", c.ongoing === null || c.ongoing === undefined ? null : c.ongoing ? "Sí" : "No");
  field("Empresas involucradas", c.companyRelationLabel ? `${c.companyRelationLabel}${c.otherCompany ? ` (${c.otherCompany})` : ""}` : null);
  doc.moveDown(0.3);
  paragraph(c.description);

  heading("4. Personas denunciadas o involucradas");
  if (c.involved.length === 0) paragraph("No se individualizaron.");
  for (const p of c.involved) paragraph(`• ${p.name}${p.relation ? ` (${p.relation})` : ""}`);

  if (c.proposal || c.outcome) {
    heading("5. Conclusiones");
    field("Conclusión propuesta", c.proposal);
    field("Propuesta el", c.proposedAt ? fmtDate(c.proposedAt) : null);
    field("Resolución", c.outcome);
  }

  heading("6. Procedimiento y plazos");
  for (const m of c.deadlines) {
    const state = m.done ? `Cumplido el ${fmtDate(m.doneAt)}` : m.dueAt ? `Pendiente · vence el ${fmtDate(m.dueAt)}` : "Pendiente";
    doc.font("Helvetica-Bold").text(m.label).font("Helvetica").fillColor("#4b5563").text(`${state} · ${m.basis}`);
    if (m.note) doc.text(m.note);
    doc.fillColor("#1f2937").moveDown(0.3);
  }

  heading("7. Trazabilidad");
  for (const e of data.events) {
    doc.font("Helvetica-Bold").text(`${fmtDateTime(e.occurred_at)} · ${e.action}`).font("Helvetica").fillColor("#4b5563").text(e.actor_label);
    if (e.detail) doc.text(e.detail);
    doc.fillColor("#1f2937").moveDown(0.3);
  }

  heading("8. Mensajes con el denunciante");
  if (data.messages.length === 0) paragraph("Sin mensajes.");
  for (const m of data.messages) {
    doc.font("Helvetica-Bold").text(`${fmtDateTime(m.createdAt)} · ${m.author}`).font("Helvetica").text(m.body).moveDown(0.3);
  }

  heading("9. Evidencias");
  if (data.files.length === 0) paragraph("No se adjuntaron evidencias.");
  for (const f of data.files) {
    doc.font("Helvetica-Bold").text(f.name).font("Helvetica").fillColor("#4b5563");
    doc.text(`${fmtSize(f.sizeBytes)} · recibida el ${fmtDateTime(f.createdAt)}`);
    if (f.sha256) doc.fontSize(8).text(`SHA-256: ${f.sha256}`).fontSize(10);
    doc.fillColor("#1f2937").moveDown(0.3);
  }

  // Número de página en cada hoja.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(8).fillColor("#9ca3af").text(`${c.code} · página ${i + 1} de ${range.count}`, 56, doc.page.height - 36, { align: "center", width: doc.page.width - 112 });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}

async function loadForDossier(tenant: Tenant, userId: string, role: CaseRole, id: string) {
  // Mismas reglas que la ficha (incluido el conflicto de interés); el auditor no ve el contenido, así que no lo genera.
  if (role === "auditor") throw new HttpError(403, "El auditor no puede generar el expediente de una denuncia.");
  return getVisibleCase(tenant, userId, role, id);
}

/** PDF del expediente para descargarlo. */
export async function buildCaseDossier(tenant: Tenant, userId: string, role: CaseRole, id: string, generatedBy: string) {
  const data = await loadForDossier(tenant, userId, role, id);
  return { code: data.case.code, pdf: await render(tenant, data, generatedBy) };
}

const sendSchema = z.object({
  milestoneKey: z.enum(DT_SEND_KEYS, { message: "Este hito no se envía a la DT" }),
  to: z.email({ message: "Correo de destino inválido" }).max(200),
  message: z.string().trim().max(3000).optional(),
  attachEvidence: z.boolean().default(true),
});

/**
 * Envía el expediente a la DT por correo y registra el hito como cumplido. Solo el gestor, solo Ley Karin y solo
 * cuando el hito está pendiente y corresponde registrarlo (mismas reglas que «Registrar»).
 */
export async function sendDossierToDt(tenant: Tenant, userId: string, role: CaseRole, id: string, generatedBy: string, raw: unknown) {
  const input = sendSchema.parse(raw);
  if (role !== "case_manager") throw new HttpError(403, "Solo el gestor de denuncias envía antecedentes a la DT.");
  const data = await loadForDossier(tenant, userId, role, id);
  const c = data.case;
  if (c.category.framework !== "ley_karin") throw new HttpError(400, "El envío a la DT solo aplica a denuncias de Ley Karin.");
  const milestone = c.deadlines.find((m) => m.key === input.milestoneKey);
  if (!milestone?.canRegister) throw new HttpError(400, "Ese paso aún no corresponde, ya fue registrado o no aplica a esta denuncia.");

  const pdf = await render(tenant, data, generatedBy);
  const attachments: { filename: string; content: Buffer; contentType?: string }[] = [
    { filename: `Expediente-${c.code}.pdf`, content: pdf, contentType: "application/pdf" },
  ];
  let total = pdf.length;
  let attached = 0;
  if (input.attachEvidence) {
    for (const f of data.files) {
      if (total + f.sizeBytes > MAX_ATTACHMENTS_BYTES) break;
      const { file, body } = await readCaseFile(tenant, id, f.id);
      attachments.push({ filename: file.file_name, content: body, contentType: file.mime });
      total += body.length;
      attached++;
    }
  }
  const skipped = input.attachEvidence ? data.files.length - attached : data.files.length;

  const company = tenant.legal_name ?? tenant.name;
  const lines = [
    `${company}${tenant.tax_id ? `, RUT ${tenant.tax_id},` : ""} remite los antecedentes de la denuncia ${c.code} (Ley 21.643): ${milestone.label.toLowerCase()}.`,
    ...(input.message ? [input.message] : []),
    `Se adjunta el expediente en PDF${attached ? ` y ${attached} evidencia(s)` : ""}.`,
    ...(skipped ? [`${skipped} evidencia(s) no se adjuntaron por tamaño; el expediente las individualiza con su huella SHA-256.`] : []),
  ];
  const route = await sendMail(
    {
      to: input.to,
      subject: `Denuncia Ley Karin ${c.code} — ${company}`,
      text: lines.join("\n\n"),
      html: lines.map((l) => `<p>${l.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`)}</p>`).join(""),
      attachments,
    },
    { tenant, organization: company },
  );
  if (!route) throw new HttpError(502, "No se pudo enviar el correo. Revisa el correo saliente o descarga el PDF y envíalo a mano.");

  const detail = `Enviado por correo a ${input.to} desde el canal: expediente PDF${attached ? ` y ${attached} evidencia(s)` : ""}.`;
  const result = await applyCaseAction(tenant, userId, role, id, "milestone", { key: input.milestoneKey, detail });
  return { ...result, attached, skipped };
}
