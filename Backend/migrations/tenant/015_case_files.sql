-- Archivos (evidencias) que el denunciante adjunta desde el seguimiento. El contenido vive en el almacenamiento
-- privado de la empresa (carpeta local o S3): <empresa>/denuncias/<ley>/<código>/<id>-<nombre>. Aquí solo quedan
-- los datos del archivo y su huella SHA-256, para acreditar que no se modificó después de recibirlo.
CREATE TABLE case_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  sender       text NOT NULL DEFAULT 'reporter' CHECK (sender IN ('reporter', 'staff')),
  file_name    text NOT NULL,
  mime         text NOT NULL,
  size_bytes   integer NOT NULL CHECK (size_bytes > 0),
  sha256       text NOT NULL,
  storage_key  text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_files_case_idx ON case_files (case_id, created_at);
