-- Flujos de gestión editables por la empresa (ISO 37002: el proceso lo define la organización).
--   * flow_templates: plantilla de cada marco (salvo Ley Karin, que fija la ley). Cada cambio crea una versión nueva;
--     las anteriores se conservan para saber con qué reglas se gestionó cada denuncia.
--   * cases.flow_template_id: versión con que partió la denuncia (NULL = flujo recomendado de la plataforma).
--   * case_tasks: tareas que el gestor agrega a una denuncia puntual.
--   * case_deadline_extensions: extensiones de plazos internos, siempre con motivo. Nunca de un plazo legal.
CREATE TABLE flow_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework   text NOT NULL CHECK (framework IN ('ley_20393', 'ley_21719', 'internal')),
  version     integer NOT NULL CHECK (version > 0),
  config      jsonb NOT NULL,
  note        text,
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (framework, version)
);

ALTER TABLE cases ADD COLUMN flow_template_id uuid REFERENCES flow_templates (id);

CREATE TABLE case_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  title       text NOT NULL,
  detail      text,
  assignee    text NOT NULL CHECK (assignee IN ('case_manager', 'investigator')),
  due_at      timestamptz,
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_tasks_case_idx ON case_tasks (case_id);

CREATE TABLE case_deadline_extensions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  milestone_key   text NOT NULL,
  previous_due_at timestamptz,
  new_due_at      timestamptz NOT NULL,
  reason          text NOT NULL,
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_deadline_extensions_case_idx ON case_deadline_extensions (case_id, milestone_key, created_at);
