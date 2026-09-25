function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

function storageConfig() {
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver !== "local" && driver !== "s3") throw new Error("STORAGE_DRIVER debe ser «local» o «s3»");
  return {
    driver: driver as "local" | "s3",
    // Carpeta raíz del modo local.
    dir: process.env.STORAGE_DIR ?? "./storage",
    s3: {
      bucket: driver === "s3" ? required("S3_BUCKET") : process.env.S3_BUCKET,
      region: process.env.S3_REGION ?? process.env.AWS_REGION ?? "us-east-1",
      // Solo para servicios compatibles con S3 (S3Mock en desarrollo). En AWS se deja vacío.
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      kmsKeyId: process.env.S3_KMS_KEY_ID || undefined,
    },
  };
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",

  // Cantidad de proxies delante del backend (Vite en desarrollo, el balanceador en AWS).
  // Se usa para obtener la IP real del cliente en el límite de intentos.
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),

  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",

  // Clave para cifrar los secretos TOTP en la base. Si se pierde, todos deben reconfigurar el 2FA.
  mfaEncryptionKey: required("MFA_ENCRYPTION_KEY"),
  mfaIssuer: process.env.MFA_ISSUER ?? "Canal de Denuncias",

  // Servidor PostgreSQL. Hoy es el contenedor de Docker; mañana el endpoint de RDS.
  db: {
    host: required("DB_HOST"),
    port: Number(process.env.DB_PORT ?? 5432),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    ssl: process.env.DB_SSL === "true",
    // Base de "mantenimiento" usada para CREATE/DROP DATABASE (existe por defecto en RDS).
    maintenanceDb: process.env.DB_MAINTENANCE_DB ?? "postgres",
  },

  globalDbName: process.env.GLOBAL_DB_NAME ?? "canal_global",
  tenantDbPrefix: process.env.TENANT_DB_PREFIX ?? "tenant_",
  // Servidor donde se crean las bases de los tenants NUEVOS. Por defecto el mismo que la global.
  // Cada tenant guarda su host/puerto, así que después se pueden repartir en varios RDS.
  tenantDbHost: process.env.TENANT_DB_HOST ?? required("DB_HOST"),
  tenantDbPort: Number(process.env.TENANT_DB_PORT ?? process.env.DB_PORT ?? 5432),

  // Archivos (logos y evidencias). «local» = carpeta en disco (desarrollo); «s3» = bucket privado (producción).
  storage: storageConfig(),

  // Auditoría: meses que se mantienen en la base (el actual incluido); los anteriores se archivan comprimidos en el
  // almacenamiento de archivos. Mínimo 1.
  audit: {
    hotMonths: Math.max(1, Number(process.env.AUDIT_HOT_MONTHS ?? 12)),
    // Minutos en que no se repite «abrió la denuncia» de la misma persona, con el mismo rol, sobre la misma denuncia.
    caseViewWindowMinutes: Math.max(0, Number(process.env.AUDIT_CASE_VIEW_WINDOW ?? 30)),
  },

  // Se crea automáticamente solo si todavía no existe ningún global_admin.
  initialGlobalAdmin: {
    email: process.env.GLOBAL_ADMIN_EMAIL,
    password: process.env.GLOBAL_ADMIN_PASSWORD,
    name: process.env.GLOBAL_ADMIN_NAME ?? "Administrador Global",
  },
};
