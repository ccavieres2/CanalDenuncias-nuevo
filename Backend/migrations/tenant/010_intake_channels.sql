-- Vías de ingreso de denuncias e identificación exigida por Ley Karin.

-- Origen: portal, recibida por la empresa (directa, remitida por otra empresa o detectada internamente) o
-- notificada por una autoridad (Dirección del Trabajo, tribunales, Agencia de Protección de Datos, Ministerio
-- Público u otra).
ALTER TABLE cases DROP CONSTRAINT cases_origin_check;
ALTER TABLE cases ADD CONSTRAINT cases_origin_check CHECK (origin IN (
  'portal', 'direct', 'other_company', 'internal', 'dt', 'court', 'agency', 'prosecutor', 'other_authority'));

ALTER TABLE cases
  -- Medio de una denuncia directa: verbal (con acta), escrita, correo, teléfono o a través de un intermediario
  -- (jefatura, sindicato, comité paritario).
  ADD COLUMN origin_channel text CHECK (origin_channel IN ('verbal', 'letter', 'email', 'phone', 'intermediary')),
  -- Plazo fijado por la autoridad que notificó (tribunal, Agencia, Fiscalía u otra).
  ADD COLUMN external_due_at timestamptz,
  -- Ley Karin (art. 11 DS 21/2024 y Ord. DT 497/21): la persona afectada debe identificarse. Si denuncia un
  -- tercero, se identifica a la persona afectada y la representación con que actúa.
  ADD COLUMN reporter_rut text,
  ADD COLUMN reporter_is_affected boolean NOT NULL DEFAULT true,
  ADD COLUMN affected_name text,
  ADD COLUMN affected_rut text,
  ADD COLUMN affected_email text,
  ADD COLUMN representation text;

UPDATE cases SET origin_channel = 'verbal' WHERE origin = 'direct';
