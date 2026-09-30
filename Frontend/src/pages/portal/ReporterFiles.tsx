import { useRef, useState } from "react";
import { Alert, Button, Icon } from "../../components/ui";
import { ApiError, uploadFile } from "../../lib/api";
import type { ReporterView } from "../../lib/portal";
import { formatBytes, formatDate } from "../../lib/ui-helpers";

/**
 * Evidencias del denunciante: lista de lo que ya adjuntó y subida de archivos nuevos (uno a la vez, en orden).
 * No se pueden descargar ni borrar desde aquí: quedan como antecedentes de la denuncia.
 */
export function ReporterFiles({
  apiBase,
  view,
  onUpdated,
  onExpired,
}: {
  apiBase: string;
  view: ReporterView;
  onUpdated: (view: ReporterView) => void;
  onExpired: (err: unknown) => boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const limits = view.fileLimits;
  const remaining = limits.maxFiles - limits.used;

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const files = Array.from(list).slice(0, Math.max(0, remaining));
    const tooBig = files.find((f) => f.size > limits.maxBytes);
    if (tooBig) {
      setError(`"${tooBig.name}" supera el máximo de ${formatBytes(limits.maxBytes)}.`);
      return;
    }
    let current = view;
    try {
      for (const [i, file] of files.entries()) {
        setProgress(files.length > 1 ? `Subiendo ${i + 1} de ${files.length}: ${file.name}` : `Subiendo ${file.name}`);
        // Cada respuesta trae una sesión renovada: se usa para el archivo siguiente.
        current = await uploadFile<ReporterView>(`${apiBase}/track/files`, file, current.session);
        onUpdated(current);
      }
      if (list.length > files.length) setError(`Solo se subieron ${files.length}: el máximo es ${limits.maxFiles} archivos.`);
    } catch (err) {
      if (!onExpired(err)) setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-white shadow-card">
      <header className="border-b border-line-soft px-5 py-4 sm:px-8">
        <span className="block text-base font-semibold text-gray-900">Archivos</span>
        <span className="block text-sm text-gray-500">
          Fotos, documentos, audios o videos que respalden tu denuncia. Solo los ve el equipo a cargo.
        </span>
      </header>
      <div className="space-y-5 px-5 py-6 sm:px-8">
        {error && <Alert>{error}</Alert>}

        {view.files.length > 0 ? (
          <ul className="divide-y divide-line-soft rounded-lg ring-1 ring-line ring-inset">
            {view.files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <Icon name="paperclip" className="size-4 shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1 truncate text-gray-800">{f.name}</span>
                <span className="shrink-0 text-xs text-gray-500">
                  {formatBytes(f.sizeBytes)} · {formatDate(f.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">Aún no has adjuntado archivos.</p>
        )}

        {view.canUpload ? (
          remaining > 0 ? (
            <div className="space-y-3">
              <input
                ref={input}
                type="file"
                multiple
                className="sr-only"
                accept={limits.extensions.map((e) => `.${e}`).join(",")}
                onChange={(e) => upload(e.target.files)}
                aria-label="Seleccionar archivos"
              />
              <Button onClick={() => input.current?.click()} loading={progress !== null} className="w-full sm:w-auto">
                <Icon name="plus" />
                Adjuntar archivos
              </Button>
              {progress && <p className="text-sm text-gray-600">{progress}…</p>}
              <p className="text-xs leading-relaxed text-gray-500">
                Hasta {formatBytes(limits.maxBytes)} por archivo y {limits.maxFiles} archivos en total. Formatos:{" "}
                {limits.extensions.join(", ")}.
                {view.isAnonymous &&
                  " Sigues siendo anónimo, pero revisa que los archivos no te identifiquen: las fotos pueden incluir la ubicación y la fecha, y los documentos, el nombre de su autor."}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Alcanzaste el máximo de {limits.maxFiles} archivos.</p>
          )
        ) : (
          <p className="text-sm text-gray-500">
            {view.status === "closed"
              ? "La denuncia está cerrada y ya no recibe archivos."
              : "Podrás adjuntar archivos cuando el equipo comience a revisar tu denuncia."}
          </p>
        )}
      </div>
    </section>
  );
}
