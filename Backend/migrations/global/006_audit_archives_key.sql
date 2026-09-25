-- Un mes puede tener más de un archivo (cada archivo lleva su fecha y nunca se sobrescribe):
-- la clave pasa a ser el archivo, no el mes.
ALTER TABLE audit_archives DROP CONSTRAINT audit_archives_pkey;
ALTER TABLE audit_archives ADD PRIMARY KEY (storage_key);
CREATE INDEX audit_archives_month_idx ON audit_archives (month DESC);
