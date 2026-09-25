import { useEffect, useState } from "react";
import { Alert, Breadcrumbs, Button, Field, Icon, PageHeader, Panel, Select } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useChannel } from "../../lib/channel-context";
import type { CaseRules, ChannelMember, ChannelMode } from "../../lib/channel-types";
import { ROLES, hasScopedRole, rolesLabel } from "../../lib/roles";

const RETENTION_OPTIONS = [24, 36, 60, 84, 120];

const MODES: Record<ChannelMode, { title: string; badge: string; description: string; points: string[] }> = {
  simplified: {
    title: "Simplificada",
    badge: "Empresas pequeñas",
    description: "Una misma persona puede recibir, investigar y cerrar las denuncias.",
    points: [
      "Una persona puede tener todos los roles, incluido el de administrador",
      "El cierre de cada caso exige un fundamento escrito que queda en la auditoría",
      "Requiere un plan ante conflicto de interés (suplente o contacto externo)",
    ],
  },
  complete: {
    title: "Completa",
    badge: "Empresas medianas y grandes",
    description: "Separación de funciones con doble aprobación de los cierres.",
    points: [
      "Quien investiga un caso no puede aprobar su propio cierre",
      "El administrador y el auditor no pueden gestionar denuncias",
      "Requiere al menos dos personas que gestionen denuncias",
    ],
  },
};

/** Garantías que el sistema aplica siempre, sin posibilidad de desactivarlas. */
const GUARANTEES = [
  {
    icon: "users" as const,
    title: "Exclusión por conflicto de interés",
    text: "Una persona involucrada en una denuncia no puede verla ni gestionarla, con ninguno de sus roles.",
  },
  {
    icon: "shield" as const,
    title: "Permisos según el rol activo",
    text: "Cada persona trabaja con un rol a la vez y solo puede hacer lo que ese rol permite. La auditoría registra con qué rol actuó.",
  },
  {
    icon: "activity" as const,
    title: "Registro inalterable",
    text: "Cada acceso y cada acción sobre una denuncia queda registrada. Las denuncias no se pueden eliminar.",
  },
  {
    icon: "clock" as const,
    title: "Plazos legales de Ley Karin",
    text: "Aviso a la Dirección del Trabajo en 3 días hábiles, medidas de resguardo inmediatas e investigación en máximo 30 días hábiles.",
  },
];

export function ChannelSettingsPage() {
  const { token, apiBase, basePath, logout } = useChannel();
  const [rules, setRules] = useState<CaseRules | null>(null);
  const [saved, setSaved] = useState<CaseRules | null>(null);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onError = (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) return logout();
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    };
    api<{ caseRules: CaseRules }>(`${apiBase}/console/settings`, { token })
      .then((res) => {
        setRules(res.caseRules);
        setSaved(res.caseRules);
      })
      .catch(onError);
    api<{ users: ChannelMember[] }>(`${apiBase}/console/users`, { token })
      .then((res) => setMembers(res.users))
      .catch(onError);
  }, [apiBase, token, logout]);

  const dirty = rules && saved && JSON.stringify(rules) !== JSON.stringify(saved);
  const candidates = members.filter((m) => m.is_active && hasScopedRole(m.roles));
  const setPlan = (patch: Partial<CaseRules["conflictPlan"]>) =>
    setRules((r) => (r ? { ...r, conflictPlan: { ...r.conflictPlan, ...patch } } : r));

  async function save() {
    if (!rules) return;
    setError(null);
    setFlash(null);
    setSaving(true);
    try {
      const res = await api<{ caseRules: CaseRules }>(`${apiBase}/console/settings/case-rules`, {
        method: "PUT",
        token,
        body: { ...rules, conflictPlan: { ...rules.conflictPlan, externalContact: rules.conflictPlan.externalContact ?? "" } },
      });
      setRules(res.caseRules);
      setSaved(res.caseRules);
      setFlash("Las reglas de gestión se guardaron.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setSaving(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio", to: basePath }, { label: "Reglas de gestión" }]} />
      <PageHeader
        title="Reglas de gestión"
        description="Cómo se organiza la gestión de las denuncias en tu empresa y por cuánto tiempo se conserva la información."
        actions={
          <Button variant="primary" onClick={save} loading={saving} disabled={!dirty} className="w-full sm:w-auto">
            Guardar cambios
          </Button>
        }
      />

      {(flash || error) && (
        <div className="mb-6 space-y-3">
          {flash && <Alert type="success">{flash}</Alert>}
          {error && <Alert>{error}</Alert>}
        </div>
      )}

      {!rules ? (
        <p className="py-16 text-center text-sm text-gray-500">Cargando…</p>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
          <div className="min-w-0 space-y-6">
            <Panel
              title="Modalidad de gestión"
              description="Elige la que corresponda al tamaño de tu equipo. Puedes cambiarla más adelante."
            >
              <div className="grid gap-4 lg:grid-cols-2" role="radiogroup" aria-label="Modalidad de gestión">
                {(Object.keys(MODES) as ChannelMode[]).map((mode) => {
                  const m = MODES[mode];
                  const selected = rules.mode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setRules({ ...rules, mode })}
                      className={`flex h-full flex-col rounded-xl p-5 text-left ring-1 transition ring-inset ${
                        selected ? "bg-accent-soft ring-2 ring-highlight" : "ring-line hover:bg-gray-50"
                      }`}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span>
                          <span className="block text-base font-semibold text-gray-900">{m.title}</span>
                          <span className="mt-0.5 block text-xs font-medium text-highlight-text">{m.badge}</span>
                        </span>
                        <span
                          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${
                            selected ? "bg-accent text-white" : "ring-2 ring-gray-300 ring-inset"
                          }`}
                        >
                          {selected && <Icon name="check" className="size-3" />}
                        </span>
                      </span>
                      <span className="mt-3 block text-sm text-gray-600">{m.description}</span>
                      <ul className="mt-4 space-y-2">
                        {m.points.map((p) => (
                          <li key={p} className="flex gap-2 text-sm text-gray-600">
                            <Icon name="check" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                            {p}
                          </li>
                        ))}
                      </ul>
                    </button>
                  );
                })}
              </div>
            </Panel>

            <Panel
              title="Plan ante conflicto de interés"
              description="Si una denuncia involucra a quien debe gestionarla, se derivará a esta alternativa. Las denuncias de Ley Karin también pueden derivarse a la Dirección del Trabajo."
            >
              <div className="grid gap-5 lg:grid-cols-2">
                <label className="block">
                  <span className="block text-sm font-medium text-gray-800">Suplente interno</span>
                  <span className="mt-0.5 block text-sm text-gray-500">Otra persona que gestione denuncias.</span>
                  <div className="mt-2">
                    <Select
                      aria-label="Suplente interno"
                      value={rules.conflictPlan.substituteUserId ?? ""}
                      onChange={(v) => setPlan({ substituteUserId: v || null })}
                    >
                      <option value="">Sin suplente</option>
                      {candidates.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} · {rolesLabel(m.roles.filter((r) => r !== "client_admin"))}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {candidates.length === 0 && (
                    <span className="mt-1.5 block text-sm text-gray-500">
                      Aún no hay usuarios con roles de {ROLES.case_manager.short.toLowerCase()} o investigador.
                    </span>
                  )}
                </label>
                <Field
                  label="Contacto externo"
                  description="Abogado, directorio o investigador externo."
                  placeholder="Nombre y correo o teléfono"
                  value={rules.conflictPlan.externalContact ?? ""}
                  onChange={(e) => setPlan({ externalContact: e.target.value })}
                />
              </div>
              {rules.mode === "simplified" && !rules.conflictPlan.substituteUserId && !rules.conflictPlan.externalContact?.trim() && (
                <div className="mt-5">
                  <Alert type="info">
                    En la modalidad simplificada es obligatorio definir al menos una alternativa: si la única persona
                    encargada es denunciada, la denuncia no puede quedar sin nadie que la reciba.
                  </Alert>
                </div>
              )}
            </Panel>

            <Panel
              title="Conservación de la información"
              description="Tiempo que se guardan las denuncias cerradas antes de anonimizarse, según la política de datos personales (Ley 21.719)."
            >
              <div className="max-w-sm">
                <Select
                  aria-label="Tiempo de conservación"
                  value={String(rules.retentionMonths)}
                  onChange={(v) => setRules({ ...rules, retentionMonths: Number(v) })}
                >
                  {RETENTION_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m / 12} años{m === 60 ? " (recomendado)" : ""}
                    </option>
                  ))}
                </Select>
                <p className="mt-2 text-sm text-gray-500">Se cuenta desde el cierre de cada denuncia. Valídalo con tu área legal.</p>
              </div>
            </Panel>
          </div>

          <Panel title="Garantías del sistema" description="Se aplicarán siempre en la gestión de denuncias, en cualquier modalidad.">
            <ul className="space-y-5">
              {GUARANTEES.map((g) => (
                <li key={g.title} className="flex gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-highlight-text">
                    <Icon name={g.icon} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900">{g.title}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-gray-500">{g.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </>
  );
}
