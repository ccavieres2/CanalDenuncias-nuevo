-- Rol con el que actuó el usuario (una persona puede tener varios roles).
ALTER TABLE audit_events ADD COLUMN actor_role text;
