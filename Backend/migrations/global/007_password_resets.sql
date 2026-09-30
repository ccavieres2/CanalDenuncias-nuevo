-- Recuperación de contraseña por correo: código de un solo uso, con vencimiento e intentos limitados.
-- Solo se guarda el hash (HMAC) del código, nunca el código.
CREATE TABLE password_resets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES global_admins(id) ON DELETE CASCADE,
  code_hash    text NOT NULL,
  expires_at   timestamptz NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  -- Se validó el código; falta elegir la contraseña nueva.
  verified_at  timestamptz,
  -- Se usó o se anuló (código nuevo, demasiados intentos).
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_account_idx ON password_resets (account_id, created_at DESC);
