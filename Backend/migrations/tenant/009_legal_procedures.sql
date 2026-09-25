-- Procedimientos legales por marco: Ley Karin (Ley 21.643 y DS 21/2024), Ley 20.393/21.595 y Ley 21.719.

-- Nuevo marco legal: protección de datos personales (Ley 21.719, vigente desde el 1 de diciembre de 2026).
ALTER TABLE categories DROP CONSTRAINT categories_legal_framework_check;
ALTER TABLE categories ADD CONSTRAINT categories_legal_framework_check
  CHECK (legal_framework IN ('ley_karin', 'ley_20393', 'ley_21719', 'internal'));

INSERT INTO categories (name, description, legal_framework, sort_order)
  SELECT 'Protección de datos personales',
         'Uso indebido, filtración, pérdida o acceso no autorizado a datos personales de trabajadores, clientes u otras personas.',
         'ley_21719', 95
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE lower(name) = 'protección de datos personales');

-- «En seguimiento»: la investigación terminó y quedan pasos posteriores (en Ley Karin: informe a la DT,
-- su pronunciamiento y la aplicación de medidas dentro de 15 días corridos).
ALTER TABLE cases DROP CONSTRAINT cases_status_check;
ALTER TABLE cases ADD CONSTRAINT cases_status_check
  CHECK (status IN ('received', 'in_review', 'investigating', 'resolution', 'follow_up', 'closed'));

ALTER TABLE cases
  -- Cómo llegó: portal web, directamente a la empresa (verbal o escrita, con acta) o notificada por la DT.
  ADD COLUMN origin            text NOT NULL DEFAULT 'portal' CHECK (origin IN ('portal', 'direct', 'dt')),
  ADD COLUMN origin_detail     text,             -- folio de la DT, a quién se entregó la denuncia verbal, etc.
  -- Ley Karin: quién investiga. internal = la empresa; dt = la Dirección del Trabajo.
  ADD COLUMN route             text CHECK (route IN ('internal', 'dt')),
  -- Ley Karin: el denunciante pidió que investigue la DT (el empleador debe derivarla).
  ADD COLUMN reporter_requests_dt boolean NOT NULL DEFAULT false,
  -- Ley Karin: relación entre empresas. same = todos de la empresa; contractor = involucra a personal de una
  -- contratista o subcontratista; principal = involucra a la empresa principal o usuaria; third_party = el
  -- agresor es un tercero ajeno a la relación laboral (cliente, proveedor, usuario).
  ADD COLUMN company_relation  text CHECK (company_relation IN ('same', 'contractor', 'principal', 'third_party')),
  ADD COLUMN other_company     text,
  -- Cuándo quedó aprobado el informe final (fin de la investigación interna).
  ADD COLUMN report_approved_at timestamptz;

-- Hitos del procedimiento legal registrados por el equipo (aviso a la DT, derivación, pronunciamiento, etc.).
CREATE TABLE case_milestones (
  case_id       uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  key           text NOT NULL,
  done_at       timestamptz NOT NULL,
  result        text,
  detail        text,
  actor_user_id uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, key)
);

-- Denuncias Ley Karin ya cargadas (de ejemplo): se tratan como investigación interna, con el aviso de inicio dado.
UPDATE cases c SET route = 'internal', company_relation = 'same'
  FROM categories k WHERE k.id = c.category_id AND k.legal_framework = 'ley_karin' AND c.status <> 'received';
INSERT INTO case_milestones (case_id, key, done_at)
  SELECT id, 'dt_start_notice', authority_notified_at FROM cases WHERE route = 'internal' AND authority_notified_at IS NOT NULL;
