import { type FormEvent, useState } from "react";
import { Alert, Button, Field, Icon, Modal, TextArea, Toggle } from "../../components/ui";
import { ApiError, api } from "../../lib/api";

// El último correo usado se recuerda en este navegador para no escribirlo en cada envío.
const LAST_TO = "cd_dt_email";
const readLastTo = () => {
  try {
    return localStorage.getItem(LAST_TO) ?? "";
  } catch {
    return "";
  }
};

/**
 * Envía el expediente (PDF + evidencias) a la Dirección del Trabajo por correo. Al enviarse, el hito queda
 * registrado como cumplido con el detalle del envío.
 */
export function SendToDtDialog({
  apiBase,
  caseId,
  token,
  milestone,
  filesCount,
  onClose,
  onDone,
}: {
  apiBase: string;
  caseId: string;
  token: string;
  milestone: { key: string; label: string };
  filesCount: number;
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const [to, setTo] = useState(readLastTo);
  const [message, setMessage] = useState("");
  const [attachEvidence, setAttachEvidence] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ attached: number; skipped: number }>(`${apiBase}/cases/${caseId}/send-dt`, {
        method: "POST",
        token,
        body: { milestoneKey: milestone.key, to: to.trim(), message: message.trim() || undefined, attachEvidence },
      });
      try {
        localStorage.setItem(LAST_TO, to.trim());
      } catch {
        // Sin almacenamiento del navegador solo se pierde el recordatorio del correo.
      }
      onDone(
        `Expediente enviado a ${to.trim()}${res.attached ? ` con ${res.attached} evidencia(s)` : ""}. El paso quedó registrado.` +
          (res.skipped ? ` ${res.skipped} evidencia(s) no se adjuntaron por tamaño: el PDF las individualiza.` : ""),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo enviar");
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Enviar a la Dirección del Trabajo"
      description={milestone.label}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="send-dt" variant="primary" loading={busy} disabled={!to.trim()}>
            <Icon name="mail" />
            Enviar
          </Button>
        </>
      }
    >
      <form id="send-dt" onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Alert type="info">
          Se envía el expediente en PDF (datos, relato, personas, plazos, trazabilidad y mensajes) desde el correo
          saliente del canal. Verifica el correo de destino: la DT también recibe estos antecedentes por su portal
          (tramites.dt.gob.cl), donde puedes subir el PDF a mano.
        </Alert>
        <Field
          label="Correo de destino"
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="correo de la inspección del trabajo"
          required
        />
        <TextArea
          label="Mensaje (opcional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={3000}
          rows={3}
          placeholder="Texto adicional para el correo"
        />
        {filesCount > 0 && (
          <Toggle
            label={`Adjuntar las evidencias (${filesCount})`}
            checked={attachEvidence}
            onChange={setAttachEvidence}
          />
        )}
      </form>
    </Modal>
  );
}
