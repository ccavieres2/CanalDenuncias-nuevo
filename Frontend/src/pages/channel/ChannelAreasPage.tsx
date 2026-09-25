import { type FormEvent, useEffect, useState } from "react";
import { ConfirmModal, RowMenu } from "../../components/dialogs";
import { Alert, Breadcrumbs, Button, Field, Icon, Modal, PageHeader, Panel } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useChannel } from "../../lib/channel-context";
import type { Area, Category } from "../../lib/channel-types";
import { FRAMEWORKS, FRAMEWORK_ORDER } from "../../lib/roles";

/** Áreas de la empresa. Cada usuario pertenece a una y cada categoría indica qué áreas pueden hacerse cargo. */
export function ChannelAreasPage() {
  const { token, apiBase, basePath, logout } = useChannel();
  const [areas, setAreas] = useState<Area[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Area | "new" | null>(null);
  const [deleting, setDeleting] = useState<Area | null>(null);
  const [permissions, setPermissions] = useState<Area | null>(null);

  useEffect(() => {
    api<{ areas: Area[] }>(`${apiBase}/console/areas`, { token })
      .then((res) => setAreas(res.areas))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [apiBase, token, logout, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio", to: basePath }, { label: "Áreas" }]} />
      <PageHeader
        title="Áreas"
        description="Unidades de la empresa a las que pertenecen los usuarios. En cada categoría se indica qué áreas pueden hacerse cargo de sus denuncias; por ejemplo, Ley Karin solo Recursos Humanos."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")} className="w-full sm:w-auto">
            <Icon name="plus" />
            Nueva área
          </Button>
        }
      />

      {(flash || error) && (
        <div className="mb-6 space-y-3">
          {flash && <Alert type="success">{flash}</Alert>}
          {error && <Alert>{error}</Alert>}
        </div>
      )}

      <Panel flush title="Áreas" counter={areas?.length}>
        {areas === null ? (
          <p className="px-6 py-16 text-center text-sm text-gray-500">Cargando…</p>
        ) : (
          <ul className="grid divide-y divide-line-soft sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-3">
            {areas.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 px-4 py-4 sm:border-b sm:border-line-soft sm:px-6 sm:odd:border-r xl:border-r xl:odd:border-r xl:[&:nth-child(3n)]:border-r-0"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                  <Icon name="building" />
                </span>
                <button type="button" onClick={() => setPermissions(a)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium text-gray-900 hover:text-accent">{a.name}</p>
                  <p className="text-xs text-gray-500">
                    {a.users} {a.users === 1 ? "usuario" : "usuarios"} · {a.categories}{" "}
                    {a.categories === 1 ? "categoría autorizada" : "categorías autorizadas"}
                  </p>
                </button>
                <RowMenu
                  label={`Acciones para ${a.name}`}
                  actions={[
                    { label: "Categorías autorizadas", onSelect: () => setPermissions(a) },
                    { label: "Renombrar", onSelect: () => setEditing(a) },
                    { label: "Eliminar", onSelect: () => setDeleting(a), danger: true, hidden: a.users > 0 || a.categories > 0 },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editing && (
        <AreaModal
          area={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(name, created) => {
            setEditing(null);
            setFlash(created ? `Se creó el área "${name}".` : `El área ahora se llama "${name}".`);
            reload();
          }}
        />
      )}

      {permissions && (
        <AreaCategoriesModal
          area={permissions}
          onClose={() => setPermissions(null)}
          onSaved={(summary) => {
            setPermissions(null);
            setFlash(summary);
            reload();
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          title={`¿Eliminar "${deleting.name}"?`}
          confirmLabel="Eliminar"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api(`${apiBase}/console/areas/${deleting.id}`, { method: "DELETE", token });
            setFlash(`Se eliminó el área "${deleting.name}".`);
            setDeleting(null);
            reload();
          }}
        >
          <p>El área no tiene usuarios ni categorías asociadas.</p>
        </ConfirmModal>
      )}
    </>
  );
}

function AreaModal({
  area,
  onClose,
  onSaved,
}: {
  area: Area | null;
  onClose: () => void;
  onSaved: (name: string, created: boolean) => void;
}) {
  const { token, apiBase } = useChannel();
  const [name, setName] = useState(area?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api(area ? `${apiBase}/console/areas/${area.id}` : `${apiBase}/console/areas`, {
        method: area ? "PATCH" : "POST",
        token,
        body: { name },
      });
      onSaved(name.trim(), !area);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setLoading(false);
    }
  }

  return (
    <Modal
      title={area ? "Renombrar área" : "Nueva área"}
      onClose={onClose}
      footer={
        <>
          <Button variant="link" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="area-form" variant="primary" loading={loading}>
            {area ? "Guardar" : "Crear área"}
          </Button>
        </>
      }
    >
      <form id="area-form" onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Nombre del área" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </form>
    </Modal>
  );
}


/**
 * Qué categorías restringidas puede tener a cargo el área. Es la misma autorización que se
 * edita en cada categoría, vista desde el área.
 */
function AreaCategoriesModal({
  area,
  onClose,
  onSaved,
}: {
  area: Area;
  onClose: () => void;
  onSaved: (summary: string) => void;
}) {
  const { token, apiBase } = useChannel();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<{ categories: Category[] }>(`${apiBase}/console/categories`, { token })
      .then((res) => {
        setCategories(res.categories);
        setSelected(res.categories.filter((c) => c.area_ids.includes(area.id)).map((c) => c.id));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Error inesperado"));
  }, [apiBase, token, area.id]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function save() {
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ added: string[]; removed: string[] }>(`${apiBase}/console/areas/${area.id}/categories`, {
        method: "PUT",
        token,
        body: { categoryIds: selected },
      });
      const parts = [
        res.added.length ? `ahora puede tener ${res.added.join(", ")}` : "",
        res.removed.length ? `ya no puede tener ${res.removed.join(", ")}` : "",
      ].filter(Boolean);
      onSaved(parts.length ? `${area.name}: ${parts.join("; ")}.` : "No hubo cambios.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setLoading(false);
    }
  }

  return (
    <Modal
      size="lg"
      title={`Categorías autorizadas: ${area.name}`}
      description="Marca las denuncias que las personas de esta área pueden tener a cargo."
      onClose={onClose}
      footer={
        <>
          <Button variant="link" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={loading} onClick={save} disabled={!categories}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}
        {!categories ? (
          <p className="text-sm text-gray-500">Cargando…</p>
        ) : (
          FRAMEWORK_ORDER.map((fw) => {
            const items = categories.filter((c) => c.legal_framework === fw);
            if (!items.length) return null;
            return (
              <div key={fw}>
                <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                  <span className={`size-2 rounded-full ${FRAMEWORKS[fw].dot}`} />
                  {FRAMEWORKS[fw].label}
                </p>
                <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
                  {items.map((c) => {
                    const open = c.area_ids.length === 0;
                    const onlyThis = c.area_ids.length === 1 && c.area_ids[0] === area.id;
                    const locked = open || onlyThis;
                    return (
                      <li key={c.id}>
                        <label
                          className={`flex items-start gap-2.5 text-sm ${locked ? "text-gray-500" : "cursor-pointer text-gray-800"}`}
                        >
                          <input
                            type="checkbox"
                            checked={open || selected.includes(c.id)}
                            disabled={locked}
                            onChange={() => toggle(c.id)}
                            className="mt-0.5 size-4 shrink-0 rounded accent-brand-navy"
                          />
                          <span className="min-w-0">
                            {c.name}
                            {locked && (
                              <span className="mt-0.5 block text-xs text-gray-400">
                                {open ? "Abierta a todas las áreas" : "Única área autorizada"}
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
        <p className="text-xs leading-relaxed text-gray-500">
          Las categorías abiertas a todas las áreas se restringen desde <strong>Categorías</strong>. Si quitas una
          categoría, las personas de esta área que la tenían asignada dejan de tenerla.
        </p>
      </div>
    </Modal>
  );
}
