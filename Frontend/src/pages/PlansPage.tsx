import { type FormEvent, useEffect, useState } from "react";
import { ConfirmModal, RowMenu } from "../components/dialogs";
import { PlanSummary } from "../components/PlanPicker";
import { Alert, Badge, Breadcrumbs, Button, Field, Icon, Modal, PageHeader, Panel, TextArea } from "../components/ui";
import { useAdmin } from "../lib/admin-context";
import { ApiError, api } from "../lib/api";
import { PLAN_FEATURES, type Plan, type PlanFeature } from "../lib/plans";
import { FRAMEWORKS, FRAMEWORK_ORDER, type LegalFramework } from "../lib/roles";

/**
 * Planes comerciales: qué marcos legales, módulos y límites tiene cada empresa. Cambiar un plan (o el plan de una
 * empresa) aplica de inmediato y nunca borra datos: lo que queda fuera solo deja de mostrarse y de poder crearse.
 */
export function PlansPage() {
  const { token, logout } = useAdmin();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const [deleting, setDeleting] = useState<Plan | null>(null);

  useEffect(() => {
    api<{ plans: Plan[] }>("/admin/plans", { token })
      .then((res) => setPlans(res.plans))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [token, logout, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  async function toggleActive(p: Plan) {
    setError(null);
    try {
      await api(`/admin/plans/${p.id}`, { method: "PUT", token, body: { ...toInput(p), isActive: !p.isActive } });
      setFlash(p.isActive ? `El plan "${p.name}" ya no se ofrece a empresas nuevas.` : `El plan "${p.name}" está activo.`);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Consola", to: "/admin" }, { label: "Planes" }]} />
      <PageHeader
        title="Planes"
        description="Qué marcos legales, módulos y límites incluye cada plan. Lo que un plan no incluye no aparece en el panel ni en el portal de la empresa."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")} className="w-full sm:w-auto">
            <Icon name="plus" />
            Nuevo plan
          </Button>
        }
      />

      {(flash || error) && (
        <div className="mb-6 space-y-3">
          {flash && <Alert type="success">{flash}</Alert>}
          {error && <Alert>{error}</Alert>}
        </div>
      )}

      {plans === null ? (
        <p className="py-16 text-center text-sm text-gray-500">Cargando planes…</p>
      ) : (
        <div className="grid items-start gap-6 md:grid-cols-2 2xl:grid-cols-3">
          {plans.map((p) => (
            <Panel
              key={p.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {p.name}
                  {!p.isActive && <Badge styles="bg-gray-100 text-gray-600 ring-gray-500/15" dot="bg-gray-400" label="Desactivado" />}
                </span>
              }
              description={`${p.tenants} ${p.tenants === 1 ? "empresa" : "empresas"} con este plan`}
              actions={
                <RowMenu
                  label={`Acciones para ${p.name}`}
                  actions={[
                    { label: "Editar", onSelect: () => setEditing(p) },
                    { label: p.isActive ? "Desactivar" : "Activar", onSelect: () => toggleActive(p), hidden: p.isActive && p.tenants > 0 },
                    { label: "Eliminar", onSelect: () => setDeleting(p), danger: true, hidden: p.tenants > 0 },
                  ]}
                />
              }
            >
              <PlanSummary plan={p} />
            </Panel>
          ))}
        </div>
      )}

      {editing && (
        <PlanModal
          plan={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(p, created) => {
            setEditing(null);
            setFlash(
              created
                ? `Se creó el plan "${p.name}".`
                : `Se actualizó el plan "${p.name}". El cambio ya aplica a sus ${p.tenants} ${p.tenants === 1 ? "empresa" : "empresas"}.`,
            );
            reload();
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          title="Eliminar plan"
          confirmLabel="Eliminar"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api(`/admin/plans/${deleting.id}`, { method: "DELETE", token });
            setDeleting(null);
            setFlash(`Se eliminó el plan "${deleting.name}".`);
            reload();
          }}
        >
          <p>
            Se eliminará el plan <strong>{deleting.name}</strong>. Ninguna empresa lo usa.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}

const toInput = (p: Plan) => ({
  name: p.name,
  description: p.description ?? "",
  frameworks: p.frameworks,
  features: p.features,
  maxUsers: p.maxUsers,
  maxAreas: p.maxAreas,
  maxCategories: p.maxCategories,
});

/** Campo numérico de límite: vacío = sin límite. */
function LimitField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <Field
      label={label}
      type="number"
      inputMode="numeric"
      min={1}
      placeholder="Sin límite"
      value={value}
      error={error}
      hint="Vacío = sin límite."
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
    />
  );
}

function PlanModal({
  plan,
  onClose,
  onSaved,
}: {
  plan: Plan | null;
  onClose: () => void;
  onSaved: (plan: Plan, created: boolean) => void;
}) {
  const { token } = useAdmin();
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [frameworks, setFrameworks] = useState<LegalFramework[]>(plan?.frameworks ?? ["ley_karin"]);
  const [features, setFeatures] = useState<PlanFeature[]>(plan?.features ?? []);
  const [limits, setLimits] = useState({
    maxUsers: plan?.maxUsers?.toString() ?? "",
    maxAreas: plan?.maxAreas?.toString() ?? "",
    maxCategories: plan?.maxCategories?.toString() ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const toNumber = (v: string) => (v ? Number(v) : null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    if (!frameworks.length) {
      setError("Incluye al menos un marco legal.");
      return;
    }
    setLoading(true);
    const body = {
      name,
      description,
      frameworks,
      features,
      maxUsers: toNumber(limits.maxUsers),
      maxAreas: toNumber(limits.maxAreas),
      maxCategories: toNumber(limits.maxCategories),
    };
    try {
      const res = await api<{ plan: Plan }>(plan ? `/admin/plans/${plan.id}` : "/admin/plans", {
        method: plan ? "PUT" : "POST",
        token,
        body,
      });
      onSaved({ ...res.plan, tenants: plan?.tenants ?? 0 }, !plan);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setFields(err instanceof ApiError ? (err.fields ?? {}) : {});
      setLoading(false);
    }
  }

  return (
    <Modal
      size="lg"
      title={plan ? `Editar plan ${plan.name}` : "Nuevo plan"}
      onClose={onClose}
      footer={
        <>
          <Button variant="link" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="plan-form" variant="primary" loading={loading}>
            {plan ? "Guardar cambios" : "Crear plan"}
          </Button>
        </>
      }
    >
      <form id="plan-form" onSubmit={handleSubmit} className="space-y-6">
        {error && <Alert>{error}</Alert>}
        {plan && plan.tenants > 0 && (
          <Alert type="info">
            {plan.tenants === 1 ? "Una empresa usa" : `${plan.tenants} empresas usan`} este plan: los cambios aplican de inmediato.
            Quitar algo no borra datos; solo deja de mostrarse y de poder crearse.
          </Alert>
        )}

        <div className="grid gap-5">
          <Field label="Nombre" required autoFocus value={name} error={fields.name} onChange={(e) => setName(e.target.value)} placeholder="Profesional" />
          <TextArea label="Descripción" value={description} onChange={(e) => setDescription(e.target.value)} hint="Uso interno del equipo BeeHives." />
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-gray-800">Marcos legales</legend>
          <p className="mt-0.5 text-sm text-gray-500">Solo estas leyes aparecerán en el portal y en las categorías de la empresa.</p>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {FRAMEWORK_ORDER.map((fw) => (
              <label key={fw} className="flex cursor-pointer items-center gap-2.5 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={frameworks.includes(fw)}
                  onChange={() => setFrameworks((l) => toggle(l, fw))}
                  className="size-4 rounded accent-brand-navy"
                />
                <span className={`size-2 rounded-full ${FRAMEWORKS[fw].dot}`} />
                {FRAMEWORKS[fw].label}
              </label>
            ))}
          </div>
          {!frameworks.includes("ley_karin") && (
            <p className="mt-3 text-xs text-amber-700">
              Ojo: la Ley Karin es obligatoria para los empleadores. Un plan sin ella solo tiene sentido si la empresa la
              gestiona por otra vía.
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-gray-800">Módulos</legend>
          <div className="mt-3 space-y-3">
            {PLAN_FEATURES.map((f) => (
              <label key={f.key} className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={features.includes(f.key)}
                  onChange={() => setFeatures((l) => toggle(l, f.key))}
                  className="mt-0.5 size-4 shrink-0 rounded accent-brand-navy"
                />
                <span>
                  <span className="block font-medium text-gray-800">{f.label}</span>
                  <span className="block text-gray-500">{f.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-gray-800">Límites</legend>
          <div className="mt-3 grid gap-5 sm:grid-cols-3">
            <LimitField label="Usuarios activos" value={limits.maxUsers} error={fields.maxUsers} onChange={(v) => setLimits((l) => ({ ...l, maxUsers: v }))} />
            <LimitField label="Áreas" value={limits.maxAreas} error={fields.maxAreas} onChange={(v) => setLimits((l) => ({ ...l, maxAreas: v }))} />
            <LimitField
              label="Categorías activas"
              value={limits.maxCategories}
              error={fields.maxCategories}
              onChange={(v) => setLimits((l) => ({ ...l, maxCategories: v }))}
            />
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
