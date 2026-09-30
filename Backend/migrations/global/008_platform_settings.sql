-- Ajustes de la plataforma que se editan desde la consola (p. ej. el correo saliente por defecto).
-- Los datos sensibles (contraseñas) se guardan cifrados dentro de value.
CREATE TABLE platform_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES global_admins(id) ON DELETE SET NULL
);
