import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router";
import { RowMenu } from "../../components/dialogs";
import { Alert, Badge, Breadcrumbs, Button, Field, Icon, Modal, PageHeader, Panel, TextArea } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useChannel } from "../../lib/channel-context";
import type { Area, Category } from "../../lib/channel-types";
import { FRAMEWORKS, type LegalFramework, FRAMEWORK_ORDER } from "../../lib/roles";


export function ChannelCategoriesPage() {
  const { token, apiBase, basePath, logout } = useChannel();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [section, setSection] = useState<LegalFramework | null>(null);

  useEffect(() => {
    const onError = (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) return logout();
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    };
    api<{ categories: Category[] }>(`${apiBase}/console/categories`, { token })
      .then((res) => setCategories(res.categories))
      .catch(onError);
    api<{ areas: Area[] }>(`${apiBase}/console/areas`, { token })
      .then((res) => setAreas(res.areas))
      .catch(onError);
  }, [apiBase, token, logout, reloadKey]);

  const areaName = new Map(areas.map((a) => [a.id, a.name]));

  const reload = () => setReloadKey((k) => k + 1);

  async function toggleActive(c: Category) {
    setError(null);
    try {
      await api(`${apiBase}/console/categories/${c.id}`, { method: "PATCH", token, body: { isActive: !c.is_active } });
      setFlash(c.is_active ? `"${c.name}" ya no aparecerá en el formulario de denuncia.` : `"${c.name}" está activa.`);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  const uncovered = categories?.filter((c) => c.is_active && c.assigned_users === 0) ?? [];

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio", to: basePath }, { label: "Categorías" }]} />
      <PageHeader
        title="Categorías de denuncia"
        description="Tipos de hechos que se pueden denunciar. El marco legal de cada categoría define los plazos y el procedimiento que se aplicará."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")} className="w-full sm:w-auto">
            <Icon name="plus" />
            Nueva categoría
          </Button>
        }
      />

      {(flash || error || uncovered.length > 0) && (
        <div className="mb-6 space-y-3">
          {flash && <Alert type="success">{flash}</Alert>}
          {error && <Alert>{error}</Alert>}
          {uncovered.length > 0 && (
            <Alert type="info">
              {uncovered.length === 1 ? "Una categoría activa no tiene" : `${uncovered.length} categorías activas no tienen`}{" "}
              responsables asignados de un área autorizada. Asigna gestores o investigadores en{" "}
              <Link to={`${basePath}/users`} className="font-medium underline">
                Usuarios y roles
              </Link>
              .
            </Alert>
          )}
        </div>
      )}

      {categories === null ? (
        <p className="py-16 text-center text-sm text-gray-500">Cargando categorías…</p>
      ) : (
        <div className="space-y-6">
          {FRAMEWORK_ORDER.map((fw) => {
            const items = categories.filter((c) => c.legal_framework === fw);
            if (!items.length) return null;
            return (
              <Panel
                key={fw}
                flush
                title={
                  <span className="flex items-center gap-2">
                    {FRAMEWORKS[fw].label}
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {items.length}
                    </span>
                  </span>
                }
                description={FRAMEWORKS[fw].description}
                actions={
                  <RowMenu
                    label={`Acciones para ${FRAMEWORKS[fw].label}`}
                    actions={[{ label: "Áreas autorizadas para toda la sección", onSelect: () => setSection(fw) }]}
                  />
                }
              >
                <ul className="divide-y divide-line-soft">
                  {items.map((c) => (
                    <li key={c.id} className={`flex items-start gap-4 px-4 py-4 sm:px-6 ${c.is_active ? "" : "bg-gray-50/60"}`}>
                      <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${c.is_active ? FRAMEWORKS[fw].dot : "bg-gray-300"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <p className={`text-sm font-medium ${c.is_active ? "text-gray-900" : "text-gray-500"}`}>{c.name}</p>
                          {!c.is_active && (
                            <Badge styles="bg-gray-100 text-gray-600 ring-gray-500/15" dot="bg-gray-400" label="Inactiva" />
                          )}
                        </div>
                        {c.description && <p className="mt-1 text-sm leading-relaxed text-gray-500">{c.description}</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-medium">
                          {c.area_ids.length > 0 && (
                            <span className="inline-flex items-center gap-1.5 text-gray-600">
                              <Icon name="lock" className="size-3.5" />
                              Solo {c.area_ids.map((id) => areaName.get(id) ?? "…").join(", ")}
                            </span>
                          )}
                          {!c.area_ids.length && (
                            <span className="inline-flex items-center gap-1.5 text-amber-700">
                              Sin áreas: nadie la gestiona y no aparece en el portal
                            </span>
                          )}
                          {c.is_active && (
                            <span
                              className={`inline-flex items-center gap-1.5 ${c.assigned_users ? "text-gray-600" : "text-amber-700"}`}
                            >
                              <Icon name="users" className="size-3.5" />
                              {c.assigned_users
                                ? `${c.assigned_users} ${c.assigned_users === 1 ? "responsable" : "responsables"}`
                                : "Sin responsables asignados"}
                            </span>
                          )}
                        </div>
                      </div>
                      <RowMenu
                        label={`Acciones para ${c.name}`}
                        actions={[
                          { label: "Editar", onSelect: () => setEditing(c) },
                          {
                            label: c.is_active ? "Desactivar" : "Activar",
                            onSelect: () => toggleActive(c),
                            danger: c.is_active,
                          },
                        ]}
                      />
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })}
        </div>
      )}

      {editing && (
        <CategoryModal
          category={editing === "new" ? null : editing}
          areas={areas}
          onClose={() => setEditing(null)}
          onSaved={(c, created) => {
            setEditing(null);
            setFlash(created ? `Se creó la categoría "${c.name}".` : `Se actualizó "${c.name}".`);
            reload();
          }}
        />
      )}

      {section && categories && (
        <SectionAreasModal
          framework={section}
          categories={categories.filter((c) => c.legal_framework === section)}
          areas={areas}
          onClose={() => setSection(null)}
          onSaved={(summary) => {
            setSection(null);
            setFlash(summary);
            reload();
          }}
          onPartial={(message) => {
            setSection(null);
            setError(message);
            reload();
          }}
        />
      )}
    </>
  );
}

/**
 * Autoriza las mismas áreas en todas las categorías de un marco legal. Reutiliza la edición de cada
 * categoría (PATCH), así cada cambio queda auditado y quita la categoría a quienes pierden la autorización.
 */
function SectionAreasModal({
  framework,
  categories,
  areas,
  onClose,
  onSaved,
  onPartial,
}: {
  framework: LegalFramework;
  categories: Category[];
  areas: Area[];
  onClose: () => void;
  onSaved: (summary: string) => void;
  onPartial: (message: string) => void;
}) {
  const { token, apiBase } = useChannel();
  // Punto de partida: las áreas que ya comparten todas las categorías de la sección.
  const common = areas.filter((a) => categories.every((c) => c.area_ids.includes(a.id))).map((a) => a.id);
  const uniform = categories.every(
    (c) => c.area_ids.length === categories[0]!.area_ids.length && c.area_ids.every((id) => common.includes(id)),
  );
  const [areaIds, setAreaIds] = useState<string[]>(common);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function save() {
    setError(null);
    if (!areaIds.length) {
      setError("Selecciona al menos un área: sin áreas nadie podría gestionar estas denuncias.");
      return;
    }
    setLoading(true);
    const next = areaIds;
    const pending = categories.filter(
      (c) => c.area_ids.length !== next.length || !c.area_ids.every((id) => next.includes(id)),
    );
    const done: string[] = [];
    for (const c of pending) {
      try {
        await api(`${apiBase}/console/categories/${c.id}`, { method: "PATCH", token, body: { areaIds: next } });
        done.push(c.name);
      } catch (err) {
        const reason = err instanceof ApiError ? err.message : "Error inesperado";
        if (!done.length) {
          setError(reason);
          setLoading(false);
          return;
        }
        return onPartial(`Se actualizaron ${done.join(", ")}, pero falló "${c.name}": ${reason}`);
      }
    }
    onSaved(done.length ? `${FRAMEWORKS[framework].label}: se actualizaron ${done.length} categorías.` : "No hubo cambios.");
  }

  return (
    <Modal
      size="lg"
      title={`Áreas autorizadas: ${FRAMEWORKS[framework].label}`}
      description={`Se aplicará a las ${categories.length} categorías de esta sección.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="link" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={loading} onClick={save}>
            Aplicar a la sección
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {!uniform && (
          <Alert type="info">
            Hoy las categorías de esta sección tienen áreas distintas. Al guardar, todas quedarán con las áreas que marques
            aquí.
          </Alert>
        )}
        <div className="rounded-lg bg-gray-50 p-4 ring-1 ring-gray-200/70 ring-inset">
          <p className="mb-3 text-sm text-gray-600">Solo las personas de estas áreas podrán tener a cargo sus denuncias.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {areas.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={areaIds.includes(a.id)}
                  onChange={() =>
                    setAreaIds((ids) => (ids.includes(a.id) ? ids.filter((x) => x !== a.id) : [...ids, a.id]))
                  }
                  className="size-4 rounded accent-brand-navy"
                />
                {a.name}
              </label>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-500">
          Si quitas un área, sus personas dejarán de tener a cargo las categorías de esta sección.
        </p>
      </div>
    </Modal>
  );
}

function CategoryModal({
  category,
  areas,
  onClose,
  onSaved,
}: {
  category: Category | null;
  areas: Area[];
  onClose: () => void;
  onSaved: (category: Category, created: boolean) => void;
}) {
  const { token, apiBase, plan } = useChannel();
  // Solo los marcos legales que incluye el plan de la empresa.
  const frameworks = FRAMEWORK_ORDER.filter((fw) => plan.frameworks.includes(fw));
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [framework, setFramework] = useState<LegalFramework>(
    category?.legal_framework ?? (frameworks.includes("internal") ? "internal" : frameworks[0]!),
  );
  const [areaIds, setAreaIds] = useState<string[]>(category?.area_ids ?? []);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    setLoading(true);
    if (!areaIds.length) {
      setError("Selecciona al menos un área: sin áreas nadie podría gestionar sus denuncias.");
      setLoading(false);
      return;
    }
    const body = { name, description, legalFramework: framework, areaIds };
    try {
      const res = await api<{ category: Category }>(
        category ? `${apiBase}/console/categories/${category.id}` : `${apiBase}/console/categories`,
        { method: category ? "PATCH" : "POST", token, body },
      );
      onSaved(res.category, !category);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setFields(err instanceof ApiError ? (err.fields ?? {}) : {});
      setLoading(false);
    }
  }

  return (
    <Modal
      size="lg"
      title={category ? "Editar categoría" : "Nueva categoría"}
      onClose={onClose}
      footer={
        <>
          <Button variant="link" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="category-form" variant="primary" loading={loading}>
            {category ? "Guardar cambios" : "Crear categoría"}
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={handleSubmit} className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <Field label="Nombre" required autoFocus value={name} error={fields.name} onChange={(e) => setName(e.target.value)} />
        <TextArea
          label="Descripción"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          hint="La verá el denunciante al elegir la categoría. Explica con palabras simples qué hechos incluye."
        />
        <fieldset>
          <legend className="text-sm font-medium text-gray-800">Marco legal</legend>
          <div className="mt-2 space-y-2">
            {frameworks.map((fw) => (
              <label
                key={fw}
                className={`flex cursor-pointer items-start gap-3 rounded-lg p-3 ring-1 transition ring-inset ${
                  framework === fw ? "bg-accent-soft ring-highlight/50" : "ring-line hover:bg-gray-50"
                }`}
              >
                <input
                  type="radio"
                  name="framework"
                  checked={framework === fw}
                  onChange={() => setFramework(fw)}
                  className="mt-0.5 size-4 accent-brand-navy"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900">{FRAMEWORKS[fw].label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{FRAMEWORKS[fw].description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-gray-800">Áreas que pueden hacerse cargo</legend>
          <p className="mt-0.5 text-sm text-gray-500">
            Solo personas de estas áreas podrán gestionar, investigar o resolver sus denuncias.
          </p>
          <div className="mt-3 rounded-lg bg-gray-50 p-4 ring-1 ring-gray-200/70 ring-inset">
            {framework === "ley_karin" && (
              <p className="mb-3 text-sm text-gray-600">Recomendado para Ley Karin: normalmente Recursos Humanos.</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {areas.map((a) => (
                <label key={a.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={areaIds.includes(a.id)}
                    onChange={() =>
                      setAreaIds((ids) => (ids.includes(a.id) ? ids.filter((x) => x !== a.id) : [...ids, a.id]))
                    }
                    className="size-4 rounded accent-brand-navy"
                  />
                  {a.name}
                </label>
              ))}
            </div>
          </div>
          {category && (
            <p className="mt-2 text-xs text-gray-500">
              Si quitas un área, las personas de esa área dejarán de tener esta categoría a cargo.
            </p>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
