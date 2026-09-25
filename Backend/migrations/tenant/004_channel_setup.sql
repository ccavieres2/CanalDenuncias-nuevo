-- Configuración del canal: roles, áreas, categorías de denuncia y ajustes.

-- Roles del canal. Solo client_admin configura; los demás gestionarán denuncias.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('client_admin', 'case_manager', 'investigator', 'resolver', 'auditor'));

ALTER TABLE users
  ADD COLUMN area           text,                         -- p. ej. "Recursos Humanos", "Legal"
  ADD COLUMN all_categories boolean NOT NULL DEFAULT true; -- false = solo las de user_categories

CREATE TABLE categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  description     text,
  -- Marco legal: define el flujo y los plazos que se aplicarán a sus denuncias.
  legal_framework text NOT NULL DEFAULT 'internal'
                  CHECK (legal_framework IN ('ley_karin', 'ley_20393', 'internal')),
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_name_key ON categories (lower(name));

-- Categorías que puede ver cada usuario (cuando all_categories = false).
CREATE TABLE user_categories (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, category_id)
);

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

INSERT INTO categories (name, description, legal_framework, sort_order) VALUES
  ('Acoso laboral',
   'Conductas que constituyan agresión u hostigamiento y que tengan como resultado el menoscabo, maltrato o humillación de un trabajador.',
   'ley_karin', 10),
  ('Acoso sexual',
   'Requerimientos de carácter sexual no consentidos por quien los recibe y que amenacen o perjudiquen su situación laboral.',
   'ley_karin', 20),
  ('Violencia en el trabajo',
   'Conductas de terceros ajenos a la relación laboral (clientes, proveedores, usuarios) que afecten a los trabajadores.',
   'ley_karin', 30),
  ('Delitos económicos y corrupción',
   'Cohecho, lavado de activos, fraude, apropiación indebida y otros delitos de la Ley 20.393 y la Ley 21.595.',
   'ley_20393', 40),
  ('Delitos medioambientales',
   'Atentados contra el medio ambiente sancionados por la Ley 21.595.',
   'ley_20393', 50),
  ('Conflicto de interés',
   'Situaciones en que intereses personales puedan influir en decisiones de la empresa.',
   'internal', 60),
  ('Discriminación',
   'Distinciones, exclusiones o preferencias arbitrarias por motivos como sexo, edad, origen, religión u orientación.',
   'internal', 70),
  ('Seguridad y salud en el trabajo',
   'Riesgos o incumplimientos que pongan en peligro la integridad de las personas.',
   'internal', 80),
  ('Incumplimiento del código de ética',
   'Faltas a las normas internas, políticas o al código de conducta de la empresa.',
   'internal', 90),
  ('Otro',
   'Hechos que no calzan en las categorías anteriores.',
   'internal', 100);

INSERT INTO settings (key, value) VALUES
  ('portal', jsonb_build_object(
     'title', 'Canal de denuncias',
     'welcome', 'Este canal te permite informar de manera segura y confidencial hechos que puedan infringir la ley o nuestras normas internas. Tu denuncia será revisada por personas designadas y no sufrirás represalias por realizarla de buena fe.',
     'policy', '',
     'allowAnonymous', true,
     'contactEmail', null)),
  ('case_rules', jsonb_build_object(
     'requireDualApproval', true,
     'retentionMonths', 60));
