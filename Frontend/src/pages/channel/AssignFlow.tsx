import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Modal } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import type { CaseAction, CaseResponse } from "../../lib/cases";
import { useChannel } from "../../lib/channel-context";
import { CaseActionDialog } from "./CaseActionDialog";

/** Pasos para dejar una denuncia con investigador, en orden. */
const STEPS: CaseAction[] = ["start_review", "set_route", "assign"];
const STEP_LABEL: Partial<Record<CaseAction, string>> = {
  start_review: "iniciar la revisión",
  set_route: "definir quién investiga (Ley Karin)",
  assign: "asignar al investigador",
};

/**
 * Asignar desde la lista: abre, uno tras otro, los pasos que le falten a la denuncia (iniciar revisión, definir el
 * procedimiento Ley Karin y asignar investigador), sin tener que entrar a la ficha.
 */
export function AssignFlow({
  caseId,
  onClose,
  onFinished,
}: {
  caseId: string;
  onClose: () => void;
  onFinished: (summary: string) => void;
}) {
  const { token, apiBase } = useChannel();
  const [data, setData] = useState<CaseResponse | null>(null);
  const [plan, setPlan] = useState<CaseAction[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    () => api<CaseResponse>(`${apiBase}/cases/${caseId}`, { token }),
    [apiBase, caseId, token],
  );

  useEffect(() => {
    load()
      .then((res) => {
        setData(res);
        // Los pasos que corresponden a esta denuncia; «asignar» siempre es el último.
        // «Definir procedimiento» solo si aún no se decidió quién investiga.
        const steps = STEPS.filter(
          (s) => s === "assign" || (res.case.actions.includes(s) && (s !== "set_route" || !res.case.route)),
        );
        setPlan(steps);
        setTotal(steps.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Error inesperado"));
  }, [load]);

  async function next(summary: string) {
    try {
      const res = await load();
      setData(res);
      const available = (step: CaseAction) =>
        res.case.actions.includes(step) && (step !== "set_route" || !res.case.route);
      // Avanza al siguiente paso del plan que ya esté disponible.
      const remaining = (plan ?? []).slice(1);
      const upcoming = remaining.findIndex(available);
      if (upcoming >= 0) return setPlan(remaining.slice(upcoming));
      // Ninguno disponible: por ejemplo, se decidió derivar a la DT y ya no corresponde investigador interno.
      if (res.case.route === "dt") return onFinished(`${summary} La investiga la Dirección del Trabajo: no requiere investigador.`);
      if (res.case.investigator) return onFinished(summary);
      setNotice(summary);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  if (error || notice) {
    return (
      <Modal
        title="Asignar investigador"
        onClose={onClose}
        footer={<Button onClick={notice ? () => onFinished(notice) : onClose}>Cerrar</Button>}
      >
        {error ? <Alert>{error}</Alert> : <Alert type="success">{notice}</Alert>}
      </Modal>
    );
  }
  if (!data || !plan) return null;

  const current = plan[0]!;
  const done = total - plan.length;

  return (
    <CaseActionDialog
      key={current}
      action={current}
      detail={data.case}
      options={data.options}
      onClose={onClose}
      onDone={(summary) => (current === "assign" ? onFinished(summary) : void next(summary))}
      intro={
        plan.length > 1 || done > 0 ? (
          <p className="rounded-lg bg-accent-soft px-3.5 py-2.5 text-sm text-gray-800 ring-1 ring-highlight/20 ring-inset">
            <strong>
              Paso {done + 1} de {total}:
            </strong>{" "}
            {STEP_LABEL[current]}
            {plan.length > 1 && <> · después: {plan.slice(1).map((s) => STEP_LABEL[s]).join(", ")}</>}
          </p>
        ) : undefined
      }
    />
  );
}

/** Una acción del flujo directamente desde la lista (p. ej., «Iniciar revisión» en la bandeja). */
export function QuickActionDialog({
  caseId,
  action,
  onClose,
  onDone,
}: {
  caseId: string;
  action: CaseAction;
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const { token, apiBase } = useChannel();
  const [data, setData] = useState<CaseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CaseResponse>(`${apiBase}/cases/${caseId}`, { token })
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Error inesperado"));
  }, [apiBase, caseId, token]);

  if (error) {
    return (
      <Modal title="Denuncia" onClose={onClose} footer={<Button onClick={onClose}>Cerrar</Button>}>
        <Alert>{error}</Alert>
      </Modal>
    );
  }
  if (!data) return null;
  if (!data.case.actions.includes(action)) {
    return (
      <Modal title="Denuncia" onClose={onClose} footer={<Button onClick={onClose}>Cerrar</Button>}>
        <Alert type="info">Esta denuncia ya avanzó de etapa. Actualiza la lista.</Alert>
      </Modal>
    );
  }
  return <CaseActionDialog action={action} detail={data.case} options={data.options} onClose={onClose} onDone={onDone} />;
}
