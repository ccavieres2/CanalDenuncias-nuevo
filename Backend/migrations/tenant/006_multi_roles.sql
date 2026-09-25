-- Varios roles por usuario. Al iniciar sesión se elige con cuál trabajar (rol activo).

ALTER TABLE users ADD COLUMN roles text[] NOT NULL DEFAULT '{}';
UPDATE users SET roles = ARRAY[role];
ALTER TABLE users ALTER COLUMN roles DROP DEFAULT;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users DROP COLUMN role;
ALTER TABLE users ADD CONSTRAINT users_roles_check CHECK (
  cardinality(roles) > 0
  AND roles <@ ARRAY['client_admin', 'case_manager', 'investigator', 'resolver', 'auditor']::text[]
);

-- Último rol usado, para ofrecerlo por defecto en el próximo ingreso.
ALTER TABLE users ADD COLUMN last_role text;

-- Modalidad de gestión: "simplified" (una persona puede llevar todo el caso) o
-- "complete" (doble aprobación: quien investiga no aprueba su propio cierre).
-- Plan ante conflicto de interés: a quién llega una denuncia cuando involucra al encargado.
UPDATE settings
SET value = (value - 'requireDualApproval') || jsonb_build_object(
      'mode', CASE WHEN COALESCE((value ->> 'requireDualApproval')::boolean, true) THEN 'complete' ELSE 'simplified' END,
      'conflictPlan', jsonb_build_object('substituteUserId', null, 'externalContact', null))
WHERE key = 'case_rules';
