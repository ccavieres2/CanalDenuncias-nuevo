/** Plantilla de los correos: simple y compatible con los clientes de correo (tablas y estilos en línea). */

const escapeHtml = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function layout({
  organization,
  title,
  paragraphs,
  code,
  footer,
}: {
  organization: string;
  title: string;
  paragraphs: string[];
  code?: string;
  footer: string;
}): string {
  const p = (t: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151">${escapeHtml(t)}</p>`;
  return `<!doctype html>
<html lang="es"><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td>
<p style="margin:0 0 24px;font-size:13px;font-weight:bold;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(organization)}</p>
<h1 style="margin:0 0 16px;font-size:22px;color:#111827">${escapeHtml(title)}</h1>
${paragraphs.map(p).join("\n")}
${
  code
    ? `<p style="margin:24px 0;text-align:center"><span style="display:inline-block;padding:14px 24px;border-radius:10px;background:#f3f4f6;font-family:'Courier New',monospace;font-size:32px;font-weight:bold;letter-spacing:8px;color:#111827">${escapeHtml(code)}</span></p>`
    : ""
}
<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:13px;line-height:1.5;color:#6b7280">${escapeHtml(footer)}</p>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#9ca3af">Canal de Denuncias · BeeHives</p>
</td></tr></table>
</body></html>`;
}
