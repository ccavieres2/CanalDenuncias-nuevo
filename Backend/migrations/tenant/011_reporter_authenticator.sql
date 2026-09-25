-- Acceso del denunciante con app de autenticación (TOTP), como alternativa a la clave de seguimiento.
-- El secreto se guarda cifrado (AES-256-GCM con MFA_ENCRYPTION_KEY), igual que el 2FA de los usuarios.
ALTER TABLE cases
  ADD COLUMN totp_secret          text,
  ADD COLUMN totp_enabled_at      timestamptz,
  ADD COLUMN totp_last_step       bigint,
  -- Bloqueo por intentos fallidos: el código de denuncia es correlativo y el de la app tiene 6 dígitos.
  ADD COLUMN totp_failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN totp_locked_until    timestamptz;

-- Marca de la empresa (logo y color) para su portal, su pantalla de ingreso y su panel.
INSERT INTO settings (key, value) VALUES ('branding', '{"primaryColor": null, "logo": null}')
ON CONFLICT (key) DO NOTHING;
