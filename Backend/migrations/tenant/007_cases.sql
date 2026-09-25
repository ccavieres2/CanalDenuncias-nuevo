-- Denuncias (casos) y su bitácora. El flujo completo (recepción pública, asignación,
-- investigación y cierre) se construye sobre estas tablas.

CREATE TABLE cases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE,                 -- p. ej. DEN-2026-0001
  category_id       uuid NOT NULL REFERENCES categories (id),
  status            text NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received', 'in_review', 'investigating', 'resolution', 'closed')),
  subject           text NOT NULL,
  description       text NOT NULL,
  is_anonymous      boolean NOT NULL DEFAULT true,
  reporter_name     text,
  reporter_email    text,
  -- Personas involucradas (denunciados, testigos). Si son usuarios del canal, su id va en
  -- involved_user_ids y quedan excluidos de la gestión del caso (conflicto de interés).
  involved          jsonb NOT NULL DEFAULT '[]',
  involved_user_ids uuid[] NOT NULL DEFAULT '{}',
  investigator_id   uuid REFERENCES users (id),
  received_at       timestamptz NOT NULL DEFAULT now(),
  due_at            timestamptz,
  closed_at         timestamptz,
  outcome           text,
  is_demo           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cases_status_idx ON cases (status, received_at DESC);
CREATE INDEX cases_investigator_idx ON cases (investigator_id);

CREATE TABLE case_events (
  id          bigserial PRIMARY KEY,
  case_id     uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_label text NOT NULL,
  action      text NOT NULL,
  detail      text
);
CREATE INDEX case_events_case_idx ON case_events (case_id, occurred_at);

CREATE SEQUENCE case_number_seq;
