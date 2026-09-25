-- Formulario de denuncia más completo: más categorías, detalle cuando se elige «Otro» y preguntas de Ley Karin.

-- «Otro» pide que la persona cuente de qué se trata (si el administrador la renombra, sigue funcionando).
ALTER TABLE categories ADD COLUMN asks_detail boolean NOT NULL DEFAULT false;
UPDATE categories SET asks_detail = true WHERE lower(name) = 'otro';

-- Categorías habituales en los canales de denuncia (solo se agregan si no existen; cada empresa puede desactivarlas).
INSERT INTO categories (name, description, legal_framework, sort_order)
SELECT v.name, v.description, v.framework, v.sort
FROM (VALUES
  ('Lavado de activos y financiamiento del terrorismo',
   'Operaciones para ocultar el origen de dinero ilícito o para financiar actividades terroristas.', 'ley_20393', 42),
  ('Colusión y libre competencia',
   'Acuerdos con competidores para fijar precios, repartirse clientes o licitaciones.', 'ley_20393', 44),
  ('Delitos informáticos',
   'Accesos indebidos a sistemas, fraude informático o sabotaje de datos (Ley 21.459).', 'ley_20393', 46),
  ('Uso indebido de bienes o recursos',
   'Uso de vehículos, equipos, dinero o tiempo de la empresa para fines personales.', 'internal', 62),
  ('Irregularidades contables o financieras',
   'Registros falsos, gastos no respaldados o manipulación de información financiera.', 'internal', 64),
  ('Seguridad de la información',
   'Contraseñas compartidas, fugas de información confidencial o incumplimiento de políticas de seguridad.', 'internal', 66),
  ('Derechos laborales',
   'Incumplimientos en jornada, horas extra, remuneraciones, descansos o vacaciones.', 'internal', 72),
  ('Consumo de alcohol o drogas',
   'Consumo o trabajo bajo sus efectos que ponga en riesgo a las personas.', 'internal', 82),
  ('Represalias por denunciar',
   'Castigos, amenazas o trato injusto contra alguien por haber denunciado o colaborado en una investigación.', 'internal', 92)
) AS v(name, description, framework, sort)
WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE lower(c.name) = lower(v.name));

-- Las de delitos, igual que las existentes: a cargo de Cumplimiento o Legal.
INSERT INTO category_areas (category_id, area_id)
SELECT c.id, a.id FROM categories c JOIN areas a ON a.name IN ('Cumplimiento', 'Legal')
WHERE c.name IN ('Lavado de activos y financiamiento del terrorismo', 'Colusión y libre competencia', 'Delitos informáticos')
ON CONFLICT DO NOTHING;

ALTER TABLE cases
  -- Qué contó la persona cuando eligió «Otro».
  ADD COLUMN topic_detail      text,
  -- Ley Karin: quién realizó la conducta respecto de la persona afectada.
  ADD COLUMN offender_relation text CHECK (offender_relation IN ('superior', 'peer', 'subordinate', 'third_party', 'other_company')),
  -- Ley Karin: si la situación sigue ocurriendo.
  ADD COLUMN ongoing           text CHECK (ongoing IN ('yes', 'no', 'unknown')),
  -- Ley Karin: la persona pide medidas de protección urgentes (art. 211-B).
  ADD COLUMN urgent_protection boolean NOT NULL DEFAULT false;
