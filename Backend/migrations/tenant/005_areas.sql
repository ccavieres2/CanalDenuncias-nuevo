-- Áreas de la empresa y áreas autorizadas por categoría.
-- Ejemplo: las denuncias de Ley Karin solo pueden estar a cargo de personas de Recursos Humanos.

CREATE TABLE areas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX areas_name_key ON areas (lower(name));

INSERT INTO areas (name) VALUES
  ('Recursos Humanos'),
  ('Cumplimiento'),
  ('Legal'),
  ('Gerencia General'),
  ('Auditoría Interna'),
  ('Prevención de Riesgos'),
  ('Administración y Finanzas'),
  ('Operaciones'),
  ('Tecnologías de la Información'),
  ('Directorio');

-- El área pasa de texto libre a una referencia. Las áreas escritas a mano se conservan.
ALTER TABLE users ADD COLUMN area_id uuid REFERENCES areas (id);
INSERT INTO areas (name)
  SELECT DISTINCT trim(area) FROM users
  WHERE area IS NOT NULL AND trim(area) <> ''
    AND lower(trim(area)) NOT IN (SELECT lower(name) FROM areas);
UPDATE users u SET area_id = a.id FROM areas a WHERE lower(a.name) = lower(trim(u.area));
ALTER TABLE users DROP COLUMN area;

-- Áreas autorizadas para cada categoría. Sin filas = cualquier área.
CREATE TABLE category_areas (
  category_id uuid NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  area_id     uuid NOT NULL REFERENCES areas (id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, area_id)
);

INSERT INTO category_areas (category_id, area_id)
  SELECT c.id, a.id FROM categories c JOIN areas a ON a.name = 'Recursos Humanos'
  WHERE c.legal_framework = 'ley_karin';

INSERT INTO category_areas (category_id, area_id)
  SELECT c.id, a.id FROM categories c JOIN areas a ON a.name IN ('Cumplimiento', 'Legal')
  WHERE c.legal_framework = 'ley_20393';

-- Asignaciones explícitas que ya no corresponden a su área se eliminan.
DELETE FROM user_categories uc
USING users u
WHERE uc.user_id = u.id
  AND EXISTS (SELECT 1 FROM category_areas ca WHERE ca.category_id = uc.category_id)
  AND NOT EXISTS (
    SELECT 1 FROM category_areas ca WHERE ca.category_id = uc.category_id AND ca.area_id = u.area_id);
