/** RUN chileno: valida el dígito verificador (módulo 11) y lo formatea como «12.345.678-5». */
export function isValidRut(input: string): boolean {
  const clean = input.replace(/[.\s-]/g, "").toUpperCase();
  if (!/^\d{1,9}[\dK]$/.test(clean)) return false;
  const body = clean.slice(0, -1);
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (sum % 11);
  return clean.slice(-1) === (rest === 11 ? "0" : rest === 10 ? "K" : String(rest));
}

export function formatRut(input: string): string {
  const clean = input.replace(/[^\dkK]/g, "").toUpperCase();
  if (clean.length < 2) return clean;
  const body = clean.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${body}-${clean.slice(-1)}`;
}
