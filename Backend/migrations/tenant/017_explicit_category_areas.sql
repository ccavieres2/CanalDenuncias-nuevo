-- Las áreas de cada categoría pasan a ser siempre explícitas: una categoría solo la puede tener a cargo un área
-- autorizada en Categorías (antes, «sin áreas» significaba «cualquier área»). Para no cambiar nada en las empresas
-- existentes, las categorías que estaban abiertas quedan autorizadas para todas sus áreas actuales; la empresa puede
-- quitar las que no correspondan. Las áreas que se creen después no quedan autorizadas por defecto.
INSERT INTO category_areas (category_id, area_id)
SELECT c.id, a.id
  FROM categories c CROSS JOIN areas a
 WHERE NOT EXISTS (SELECT 1 FROM category_areas ca WHERE ca.category_id = c.id)
ON CONFLICT DO NOTHING;
