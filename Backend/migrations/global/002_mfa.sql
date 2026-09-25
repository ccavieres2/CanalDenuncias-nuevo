-- Doble factor (TOTP) para los global_admin.
ALTER TABLE global_admins
  ADD COLUMN totp_secret     text,         -- cifrado con MFA_ENCRYPTION_KEY
  ADD COLUMN totp_enabled_at timestamptz,  -- NULL = aún no termina de configurarlo
  ADD COLUMN totp_last_step  bigint,       -- último código usado (evita reutilizarlo)
  ADD COLUMN recovery_codes  text[] NOT NULL DEFAULT '{}';  -- hashes SHA-256
