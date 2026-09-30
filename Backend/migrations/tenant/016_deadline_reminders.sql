-- Recordatorios diarios de plazos por correo: una fila por persona y día enviado. La clave primaria garantiza un
-- solo correo al día aunque el proceso corra varias veces o haya más de una instancia del backend.
CREATE TABLE deadline_reminders (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  sent_on    date NOT NULL,
  overdue    integer NOT NULL,
  due_soon   integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sent_on)
);
