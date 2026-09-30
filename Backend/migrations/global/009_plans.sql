-- Planes comerciales: qué marcos legales, módulos y límites tiene cada empresa. Los define el equipo BeeHives
-- desde la consola. Cambiar el plan de una empresa nunca borra datos: solo impide crear lo que el plan no incluye.
CREATE TABLE plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  description     text,
  -- Marcos legales habilitados: ley_karin, ley_20393, ley_21719, internal.
  frameworks      text[] NOT NULL DEFAULT '{}',
  -- Módulos habilitados (ver PLAN_FEATURES en services/plans.ts).
  features        text[] NOT NULL DEFAULT '{}',
  -- Límites; NULL = sin límite.
  max_users       integer CHECK (max_users > 0),
  max_areas       integer CHECK (max_areas > 0),
  max_categories  integer CHECK (max_categories > 0),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX plans_name_key ON plans (lower(name));

INSERT INTO plans (name, description, frameworks, features) VALUES (
  'Completo',
  'Todos los marcos legales y módulos, sin límites.',
  ARRAY['ley_karin', 'ley_20393', 'ley_21719', 'internal'],
  ARRAY['evidence', 'custom_flows', 'branding', 'custom_smtp', 'reporter_authenticator', 'reports', 'register_cases']
);
INSERT INTO plans (name, description, frameworks, features, max_users) VALUES (
  'Básico',
  'Solo Ley Karin, hasta 5 usuarios.',
  ARRAY['ley_karin'],
  ARRAY['reporter_authenticator'],
  5
);

-- Las empresas existentes quedan en el plan Completo: nada cambia para ellas.
ALTER TABLE tenants ADD COLUMN plan_id uuid REFERENCES plans (id);
UPDATE tenants SET plan_id = (SELECT id FROM plans WHERE name = 'Completo');
ALTER TABLE tenants ALTER COLUMN plan_id SET NOT NULL;
