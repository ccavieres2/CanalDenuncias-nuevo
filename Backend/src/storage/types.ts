/**
 * Almacenamiento de archivos (logos, evidencias). Hoy una carpeta local; en producción un bucket S3 privado.
 * Se elige con STORAGE_DRIVER («local» o «s3») sin cambiar el resto del código.
 *
 * Las claves son rutas relativas con la empresa como primer segmento (ver keys.ts), igual que cada empresa tiene
 * su propia base de datos: «upshield/branding/…», «upshield/denuncias/ley-karin/DEN-2026-0001/…».
 */
export interface ObjectStorage {
  /** Nombre del medio, para los registros de arranque. */
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** null si no existe. */
  get(key: string): Promise<Buffer | null>;
  /** No falla si no existe. */
  remove(key: string): Promise<void>;
  /** Borra todo lo que empiece con el prefijo (p. ej. los archivos de una denuncia). */
  removePrefix(prefix: string): Promise<void>;
}

/** Claves seguras: sin «..», sin rutas absolutas ni caracteres especiales. */
export function assertSafeKey(key: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)+$/.test(key) || key.includes("..")) {
    throw new Error(`Clave de almacenamiento inválida: ${key}`);
  }
}
