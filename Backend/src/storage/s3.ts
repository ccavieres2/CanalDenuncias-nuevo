import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  type ServerSideEncryption,
} from "@aws-sdk/client-s3";
import { type ObjectStorage, assertSafeKey } from "./types.js";

export interface S3Options {
  bucket: string;
  region: string;
  /** Solo para servicios compatibles (S3Mock en desarrollo). En AWS se omite. */
  endpoint?: string;
  forcePathStyle?: boolean;
  /** Clave KMS opcional; si no se indica, se cifra con las claves administradas por S3 (AES-256). */
  kmsKeyId?: string;
}

/**
 * Bucket S3 privado (producción). Las credenciales se toman de la cadena estándar de AWS: el rol IAM de la instancia
 * o tarea en AWS, o AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY. Todo objeto se guarda cifrado. El bucket debe tener el
 * acceso público bloqueado: los archivos solo se entregan a través del backend, que valida permisos.
 */
export class S3Storage implements ObjectStorage {
  readonly name: string;
  private readonly client: S3Client;

  constructor(private readonly opts: S3Options) {
    this.name = `S3 (bucket ${opts.bucket}${opts.endpoint ? ` en ${opts.endpoint}` : ""})`;
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle,
    });
  }

  private encryption(): { ServerSideEncryption: ServerSideEncryption; SSEKMSKeyId?: string } {
    return this.opts.kmsKeyId
      ? { ServerSideEncryption: "aws:kms", SSEKMSKeyId: this.opts.kmsKeyId }
      : { ServerSideEncryption: "AES256" };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.opts.bucket, Key: key, Body: body, ContentType: contentType, ...this.encryption() }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    assertSafeKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }

  async removePrefix(prefix: string): Promise<void> {
    const clean = `${prefix.replace(/\/+$/, "")}/`;
    assertSafeKey(`${clean}x`);
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.opts.bucket, Prefix: clean, ContinuationToken: token }),
      );
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.opts.bucket, Delete: { Objects: keys, Quiet: true } }));
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
}
