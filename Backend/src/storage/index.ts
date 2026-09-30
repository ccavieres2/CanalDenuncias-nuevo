import { config } from "../config.js";
import { LocalStorage } from "./local.js";
import { S3Storage } from "./s3.js";
import type { ObjectStorage } from "./types.js";

export type { ObjectStorage } from "./types.js";

/** Almacenamiento de archivos configurado (STORAGE_DRIVER=local | s3). */
export const storage: ObjectStorage =
  config.storage.driver === "s3"
    ? new S3Storage({
        bucket: config.storage.s3.bucket!,
        region: config.storage.s3.region,
        endpoint: config.storage.s3.endpoint,
        forcePathStyle: config.storage.s3.forcePathStyle,
        kmsKeyId: config.storage.s3.kmsKeyId,
      })
    : new LocalStorage(config.storage.dir);
