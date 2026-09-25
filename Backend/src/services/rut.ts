/** RUN/RUT chileno: normaliza a «12345678-5» y valida el dígito verificador (módulo 11). */
export function normalizeRut(input: string): string | null {
  const clean = input.replace(/[.\s-]/g, "").toUpperCase();
  if (!/^\d{1,9}[\dK]$/.test(clean)) return null;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (sum % 11);
  const expected = rest === 11 ? "0" : rest === 10 ? "K" : String(rest);
  return dv === expected ? `${Number(body)}-${dv}` : null;
}
