-- Base de control (canal_global): administradores globales y catálogo de tenants.

CREATE TABLE global_admins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  name          text NOT NULL,
  password_hash text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX global_admins_email_key ON global_admins (lower(email));

CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  -- Dónde vive la base de este tenant. Permite mover tenants entre servidores/RDS.
  db_name    text NOT NULL UNIQUE,
  db_host    text NOT NULL,
  db_port    integer NOT NULL DEFAULT 5432,
  status     text NOT NULL DEFAULT 'provisioning'
             CHECK (status IN ('provisioning', 'active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
