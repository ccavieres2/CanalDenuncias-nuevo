import { useOutletContext } from "react-router";
import type { User } from "./types";

export interface AdminContext {
  user: User;
  token: string;
  logout: () => void;
  /** Guarda una sesión nueva (tras cambiar la contraseña). */
  updateToken: (token: string) => void;
}

/** Datos de sesión para las páginas dentro de la consola (los entrega AdminLayout). */
export const useAdmin = () => useOutletContext<AdminContext>();
