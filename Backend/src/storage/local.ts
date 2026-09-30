import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { type ObjectStorage, assertSafeKey } from "./types.js";

/**
 * Carpeta local (desarrollo). Misma estructura que tendrá el bucket S3:
 * <STORAGE_DIR>/<empresa>/branding/…, <STORAGE_DIR>/<empresa>/denuncias/<ley>/<código>/…
 */
export class LocalStorage implements ObjectStorage {
  readonly name: string;
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
    this.name = `carpeta local (${this.root})`;
  }

  private path(key: string): string {
    assertSafeKey(key);
    const full = resolve(join(this.root, key));
    // Defensa extra: la ruta final debe quedar dentro de la carpeta raíz.
    if (!full.startsWith(this.root + sep)) throw new Error(`Clave fuera de la carpeta de almacenamiento: ${key}`);
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    // Escritura atómica: primero un temporal y luego se renombra, para no dejar archivos a medias.
    const tmp = `${full}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, full);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async removePrefix(prefix: string): Promise<void> {
    const clean = prefix.replace(/\/+$/, "");
    assertSafeKey(`${clean}/x`);
    await rm(this.path(clean), { recursive: true, force: true });
  }
}
