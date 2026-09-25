-- Consola de administración: contraseñas temporales, ficha de empresa y auditoría.

-- Contraseñas temporales: el usuario debe cambiarla en su próximo ingreso.
-- password_changed_at invalida las sesiones abiertas antes de un cambio o reseteo.
ALTER TABLE global_admins
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN password_changed_at  timestamptz NOT NULL DEFAULT now();

-- Ficha comercial de la empresa.
ALTER TABLE tenants
  ADD COLUMN legal_name    text,
  ADD COLUMN tax_id        text,
  ADD COLUMN contact_name  text,
  ADD COLUMN contact_email text,
  ADD COLUMN contact_phone text,
  ADD COLUMN notes         text;

-- Bitácora de auditoría: quién hizo qué, cuándo y desde dónde. Solo se inserta, nunca se modifica.
CREATE TABLE audit_events (
  id           bigserial PRIMARY KEY,
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
  metadata     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_occurred_at_idx ON audit_events (occurred_at DESC);
CREATE INDEX audit_events_action_idx ON audit_events (action, occurred_at DESC);
CREATE INDEX audit_events_tenant_idx ON audit_events (tenant_slug, occurred_at DESC);
