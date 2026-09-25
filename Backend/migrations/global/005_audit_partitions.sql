-- Auditoría particionada por mes (PostgreSQL nativo), para que crezca sin volverse lenta:
-- las consultas recientes leen solo los meses necesarios y los meses antiguos se archivan en el almacenamiento de
-- archivos (comprimidos) y se eliminan de la base al instante, sin fragmentar la tabla.

ALTER TABLE audit_events RENAME TO audit_events_old;
ALTER TABLE audit_events_old RENAME CONSTRAINT audit_events_pkey TO audit_events_old_pkey;
ALTER INDEX audit_events_occurred_at_idx RENAME TO audit_events_old_occurred_at_idx;
ALTER INDEX audit_events_action_idx RENAME TO audit_events_old_action_idx;
ALTER INDEX audit_events_tenant_idx RENAME TO audit_events_old_tenant_idx;
-- La secuencia de ids se conserva (los cursores de paginación siguen siendo válidos).
ALTER SEQUENCE audit_events_id_seq OWNED BY NONE;

CREATE TABLE audit_events (
  id           bigint NOT NULL DEFAULT nextval('audit_events_id_seq'),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid,
  actor_email  text,
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  target_label text,
  tenant_slug  text,
  ip           text,
  user_agent   text,
  metadata     jsonb NOT NULL DEFAULT '{}',
  actor_role   text,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
ALTER SEQUENCE audit_events_id_seq OWNED BY audit_events.id;

-- Red de seguridad: si faltara el mes, el evento no se pierde (el mantenimiento lo mueve a su mes).
CREATE TABLE audit_events_default PARTITION OF audit_events DEFAULT;

-- Un mes por partición, desde el evento más antiguo hasta dos meses adelante.
DO $$
DECLARE
  m date := date_trunc('month', COALESCE((SELECT min(occurred_at) FROM audit_events_old), now()))::date;
  last date := (date_trunc('month', now()) + interval '2 months')::date;
BEGIN
  WHILE m <= last LOOP
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF audit_events FOR VALUES FROM (%L) TO (%L)',
      'audit_events_y' || to_char(m, 'YYYY') || 'm' || to_char(m, 'MM'),
      m, (m + interval '1 month')::date);
    m := (m + interval '1 month')::date;
  END LOOP;
END $$;

INSERT INTO audit_events
  (id, occurred_at, actor_id, actor_email, action, target_type, target_id, target_label, tenant_slug, ip, user_agent, metadata, actor_role)
SELECT id, occurred_at, actor_id, actor_email, action, target_type, target_id, target_label, tenant_slug, ip, user_agent, metadata, actor_role
FROM audit_events_old;

DROP TABLE audit_events_old;

-- Índices (se crean en cada mes automáticamente).
CREATE INDEX audit_events_occurred_at_idx ON audit_events (occurred_at DESC);
CREATE INDEX audit_events_action_idx ON audit_events (action, occurred_at DESC);
CREATE INDEX audit_events_tenant_idx ON audit_events (tenant_slug, occurred_at DESC);
CREATE INDEX audit_events_id_idx ON audit_events (id DESC);
-- Para no repetir «abrió la denuncia» de la misma persona en pocos minutos.
CREATE INDEX audit_events_case_views_idx ON audit_events (actor_id, target_id, occurred_at DESC) WHERE action = 'case.viewed';

-- Meses ya archivados: dónde quedó cada archivo, para ubicarlo si se necesita.
CREATE TABLE audit_archives (
  month       date PRIMARY KEY,
  storage_key text NOT NULL,
  events      bigint NOT NULL,
  bytes       bigint NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);
