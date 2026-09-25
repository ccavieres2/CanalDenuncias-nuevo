/**
 * Logo BeeHives. Variantes en /public/brand:
 * - beehives-wordmark.svg        colores originales, sin bajada (fondos claros)
 * - beehives-wordmark-white.svg  marino → blanco (fondos oscuros)
 * - beehives-icon.svg            solo el hexágono (favicon y espacios reducidos)
 */
export function BrandLogo({ tone = "dark", className = "h-8" }: { tone?: "dark" | "light"; className?: string }) {
  return (
    <img
      src={tone === "dark" ? "/brand/beehives-wordmark-white.svg" : "/brand/beehives-wordmark.svg"}
      alt="BeeHives"
      className={`w-auto select-none ${className}`}
      draggable={false}
    />
  );
}

export function BrandMark({ className = "size-9" }: { className?: string }) {
  return <img src="/brand/beehives-icon.svg" alt="BeeHives" className={`select-none ${className}`} draggable={false} />;
}

/**
 * Logo + nombre del producto. `tone` según el fondo; `stacked` pone el nombre
 * bajo el logo (para espacios angostos como la barra lateral).
 */
export function Brand({
  tone = "dark",
  caption,
  stacked = false,
  logoUrl,
}: {
  tone?: "dark" | "light";
  caption?: string;
  stacked?: boolean;
  /** Logo propio de la empresa: reemplaza al de BeeHives (sobre fondo blanco); el texto se mantiene igual. */
  logoUrl?: string | null;
}) {
  const title = tone === "dark" ? "text-white" : "text-gray-900";
  const sub = tone === "dark" ? "text-white/55" : "text-gray-500";
  const product = (
    <div className="min-w-0 leading-tight">
      <p className={`truncate text-sm font-semibold tracking-tight ${title}`}>Canal de Denuncias</p>
      {caption && <p className={`truncate text-xs ${sub}`}>{caption}</p>}
    </div>
  );

  if (stacked) {
    return (
      <div className="space-y-3">
        {logoUrl ? (
          <div className="flex h-14 items-center justify-center rounded-xl bg-white px-4">
            <img src={logoUrl} alt={caption ?? ""} className="max-h-9 w-auto max-w-full object-contain" />
          </div>
        ) : (
          <BrandLogo tone={tone} className="h-9" />
        )}
        {product}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <BrandLogo tone={tone} className="h-8 shrink-0" />
      <span className={`h-8 w-px shrink-0 ${tone === "dark" ? "bg-white/20" : "bg-gray-300"}`} />
      {product}
    </div>
  );
}
