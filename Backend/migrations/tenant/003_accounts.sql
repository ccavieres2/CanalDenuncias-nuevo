-- Contraseñas temporales e invalidación de sesiones al cambiar/resetear la contraseña.
ALTER TABLE users
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN password_changed_at  timestamptz NOT NULL DEFAULT now();
