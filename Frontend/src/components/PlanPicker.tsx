import { Link } from "react-router";
import { PLAN_FEATURES, type Plan } from "../lib/plans";
import { FRAMEWORKS, FRAMEWORK_ORDER } from "../lib/roles";
import { Icon, Select } from "./ui";

const limitText = (n: number | null, one: string, many: string) => (n === null ? `${many} ilimitados` : `Hasta ${n} ${n === 1 ? one : many}`);

/** Qué incluye un plan, en pocas líneas. */
export function PlanSummary({ plan }: { plan: Plan }) {
  return (
    <div className="space-y-3 text-sm">
      {plan.description && <p className="text-gray-600">{plan.description}</p>}
      <div className="flex flex-wrap gap-1.5">
        {FRAMEWORK_ORDER.filter((fw) => plan.frameworks.includes(fw)).map((fw) => (
          <span key={fw} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${FRAMEWORKS[fw].styles}`}>
            <span className={`size-1.5 rounded-full ${FRAMEWORKS[fw].dot}`} />
            {FRAMEWORKS[fw].label}
          </span>
        ))}
      </div>
      <ul className="space-y-1 text-gray-600">
        <li>{limitText(plan.maxUsers, "usuario", "usuarios")}</li>
        <li>{limitText(plan.maxAreas, "área", "áreas")}</li>
        <li>{limitText(plan.maxCategories, "categoría", "categorías")}</li>
      </ul>
      <ul className="space-y-1">
        {PLAN_FEATURES.map((f) => {
          const on = plan.features.includes(f.key);
          return (
            <li key={f.key} className={`flex items-center gap-2 ${on ? "text-gray-800" : "text-gray-400 line-through"}`}>
              <Icon name={on ? "check" : "close"} className={`size-3.5 shrink-0 ${on ? "text-emerald-600" : "text-gray-300"}`} />
              {f.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Selector de plan con el resumen del elegido. Solo ofrece planes activos (y el actual, aunque esté desactivado). */
export function PlanPicker({
  plans,
  value,
  onChange,
  error,
}: {
  plans: Plan[] | null;
  value: string;
  onChange: (id: string) => void;
  error?: string;
}) {
  if (!plans) return <p className="text-sm text-gray-500">Cargando planes…</p>;
  const options = plans.filter((p) => p.isActive || p.id === value);
  const selected = plans.find((p) => p.id === value);
  return (
    <div className="space-y-4">
      <div>
        <Select value={value} onChange={onChange} aria-label="Plan" required>
          <option value="" disabled>
            Selecciona un plan
          </option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isActive ? "" : " (desactivado)"}
            </option>
          ))}
        </Select>
        {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
      </div>
      {selected && <PlanSummary plan={selected} />}
      <Link to="/admin/plans" className="inline-block text-sm font-medium text-highlight-text hover:underline">
        Administrar planes
      </Link>
    </div>
  );
}
