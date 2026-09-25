import { globalPool } from "../db/pool.js";
import { HttpError, isUniqueViolation } from "../errors.js";
import { hashPassword } from "./auth.js";
import { generateTemporaryPassword } from "./passwords.js";
import type { IssuedCredentials, NewAccount } from "./tenants.js";

/** Miembro del equipo BeeHives con acceso a la consola (global_admin). */
export interface TeamMember {
  id: string;
  email: string;
  name: string;
  is_active: boolean;
  must_change_password: boolean;
  mfa_enabled: boolean;
  created_at: Date;
  last_login_at: Date | null;
}

const MEMBER_COLUMNS = `id, email, name, is_active, must_change_password, created_at, last_login_at,
  (totp_enabled_at IS NOT NULL) AS mfa_enabled`;

export async function listTeam(): Promise<TeamMember[]> {
  const res = await globalPool.query<TeamMember>(`SELECT ${MEMBER_COLUMNS} FROM global_admins ORDER BY created_at`);
  return res.rows;
}

export async function getTeamMember(id: string): Promise<TeamMember> {
  const res = await globalPool.query<TeamMember>(`SELECT ${MEMBER_COLUMNS} FROM global_admins WHERE id = $1`, [id]);
  if (!res.rows[0]) throw new HttpError(404, "Usuario no encontrado");
  return res.rows[0];
}

/** Crea un global_admin con contraseña temporal (deberá cambiarla y configurar 2FA al ingresar). */
export async function createTeamMember(input: NewAccount): Promise<{ member: TeamMember; credentials: IssuedCredentials }> {
  const temporaryPassword = generateTemporaryPassword();
  try {
    const res = await globalPool.query<TeamMember>(
      `INSERT INTO global_admins (email, name, password_hash, must_change_password)
       VALUES ($1, $2, $3, true)
       RETURNING ${MEMBER_COLUMNS}`,
      [input.email, input.name, await hashPassword(temporaryPassword)],
    );
    return { member: res.rows[0]!, credentials: { email: input.email, temporaryPassword } };
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, `Ya existe un usuario con el email ${input.email}`);
    throw err;
  }
}
