-- Redacción más clara de algunas descripciones de categorías por defecto. Solo se cambian si la empresa no las
-- editó (la descripción sigue siendo exactamente la original).
UPDATE categories SET description = v.new_text
FROM (VALUES
  ('Conductas que constituyan agresión u hostigamiento y que tengan como resultado el menoscabo, maltrato o humillación de un trabajador.',
   'Agresiones u hostigamientos, por una sola vez o de forma reiterada, que menoscaben, maltraten o humillen a una persona trabajadora, o que amenacen o perjudiquen su situación laboral.'),
  ('Requerimientos de carácter sexual no consentidos por quien los recibe y que amenacen o perjudiquen su situación laboral.',
   'Requerimientos de carácter sexual, por cualquier medio, no consentidos por quien los recibe y que amenacen o perjudiquen su situación laboral o sus oportunidades en el empleo.'),
  ('Conductas de terceros ajenos a la relación laboral (clientes, proveedores, usuarios) que afecten a los trabajadores.',
   'Conductas de clientes, proveedores, usuarios u otras personas ajenas a la empresa que afecten a quienes trabajan, durante la prestación de sus servicios.'),
  ('Hechos que no calzan en las categorías anteriores.',
   'Hechos que no corresponden a ninguna de las categorías anteriores.'),
  ('Consumo o trabajo bajo sus efectos que ponga en riesgo a las personas.',
   'Consumir alcohol o drogas en el trabajo, o trabajar bajo sus efectos, poniendo en riesgo a las personas.'),
  ('Acuerdos con competidores para fijar precios, repartirse clientes o licitaciones.',
   'Acuerdos con competidores para fijar precios, repartirse clientes o zonas, o coordinarse en licitaciones.')
) AS v(old_text, new_text)
WHERE categories.description = v.old_text;
