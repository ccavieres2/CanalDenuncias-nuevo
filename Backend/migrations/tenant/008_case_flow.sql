-- Flujo de gestión de denuncias: recepción pública, seguimiento del denunciante, mensajes y acciones.

-- Datos del formulario público.
ALTER TABLE cases
  ADD COLUMN tracking_key_hash    text UNIQUE,          -- sha256 de la clave de seguimiento del denunciante
  ADD COLUMN reporter_phone       text,
  ADD COLUMN reporter_relation    text,                 -- trabajador, proveedor, cliente, ex trabajador, otro
  ADD COLUMN occurred_when        text,
  ADD COLUMN occurred_where       text,
  ADD COLUMN privacy_accepted_at  timestamptz;

-- Hitos del flujo. Los plazos se dan por cumplidos según estas marcas, no solo por el estado.
ALTER TABLE cases
  ADD COLUMN acknowledged_at        timestamptz,        -- acuse de recibo al denunciante
  ADD COLUMN measures_at            timestamptz,        -- primera medida de resguardo
  ADD COLUMN authority_notified_at  timestamptz,        -- aviso a la Dirección del Trabajo u otra autoridad
  ADD COLUMN finding                text CHECK (finding IN ('substantiated', 'partially', 'unsubstantiated', 'inadmissible')),
  ADD COLUMN proposal               text,               -- conclusión propuesta (investigador) o motivo de desestimación (gestor)
  ADD COLUMN proposed_at            timestamptz,
  ADD COLUMN proposed_by            uuid REFERENCES users (id),
  ADD COLUMN resolved_by            uuid REFERENCES users (id);

-- Las denuncias ya cargadas (de ejemplo) conservan el significado que tenían sus estados.
UPDATE cases SET acknowledged_at = received_at, measures_at = received_at WHERE status <> 'received';
UPDATE cases c SET authority_notified_at = c.received_at + interval '1 day'
  FROM categories k WHERE k.id = c.category_id AND k.legal_framework = 'ley_karin' AND c.status <> 'received';
UPDATE cases SET proposal = outcome, proposed_at = COALESCE(closed_at, now()), finding = 'substantiated'
  WHERE status IN ('resolution', 'closed');
UPDATE cases SET outcome = NULL WHERE status = 'resolution';

-- Bitácora: quién hizo cada paso y de qué tipo es.
ALTER TABLE case_events
  ADD COLUMN kind          text NOT NULL DEFAULT 'event',   -- event, measure, diligence, note, authority, decision
  ADD COLUMN actor_user_id uuid REFERENCES users (id),
  ADD COLUMN actor_role    text;

-- Conversación con el denunciante (buzón seguro).
CREATE TABLE case_messages (
  id             bigserial PRIMARY KEY,
  case_id        uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  sender         text NOT NULL CHECK (sender IN ('reporter', 'staff')),
  author_user_id uuid REFERENCES users (id),
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Cuándo lo leyó la otra parte (el equipo o el denunciante).
  read_at        timestamptz
);
CREATE INDEX case_messages_case_idx ON case_messages (case_id, created_at);
