import { type FormEvent, useState } from "react";
import { ApiError } from "../lib/api";
import { formatDate } from "../lib/ui-helpers";
import { Alert, Button, Icon } from "./ui";

export interface ThreadMessage {
  id: string;
  /** Si lo escribió quien está mirando (a la derecha). */
  mine: boolean;
  author: string;
  body: string;
  createdAt: string;
  /** Solo para mensajes propios: cuándo lo leyó la otra parte. */
  readAt?: string | null;
}

/** Conversación entre el denunciante y el equipo del canal. */
export function MessageThread({ messages, empty }: { messages: ThreadMessage[]; empty: string }) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center px-4 py-10 text-center">
        <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-accent-soft text-highlight-text">
          <Icon name="mail" />
        </span>
        <p className="max-w-sm text-sm text-gray-500">{empty}</p>
      </div>
    );
  }
  return (
    <ol className="space-y-4">
      {messages.map((m) => (
        <li key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[85%] sm:max-w-[75%] ${m.mine ? "items-end" : "items-start"} flex flex-col`}>
            <div
              className={`rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-line ${
                m.mine ? "rounded-br-md bg-highlight text-white" : "rounded-bl-md bg-gray-100 text-gray-900"
              }`}
            >
              {m.body}
            </div>
            <p className="mt-1 px-1 text-xs text-gray-500">
              {m.author} · {formatDate(m.createdAt, true)}
              {m.mine && m.readAt !== undefined && (
                <span className={m.readAt ? "text-emerald-700" : ""}> · {m.readAt ? "Leído" : "No leído aún"}</span>
              )}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Caja para escribir un mensaje. `onSend` debe lanzar ApiError si falla. */
export function MessageComposer({
  onSend,
  placeholder,
  hint,
}: {
  onSend: (body: string) => Promise<void>;
  placeholder: string;
  hint?: string;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(body.trim());
      setBody("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo enviar el mensaje");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <Alert>{error}</Alert>}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        maxLength={5000}
        rows={3}
        className="block min-h-20 w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-base text-gray-900 shadow-sm outline-none transition placeholder:text-gray-400 focus:border-highlight focus:ring-4 focus:ring-highlight/20 sm:text-sm"
      />
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        {hint ? <p className="text-xs text-gray-500">{hint}</p> : <span />}
        <Button type="submit" variant="primary" loading={busy} disabled={!body.trim()} className="w-full sm:w-auto">
          <Icon name="mail" />
          Enviar mensaje
        </Button>
      </div>
    </form>
  );
}
