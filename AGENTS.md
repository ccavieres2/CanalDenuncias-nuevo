# AGENTS.md — Guía del proyecto para asistentes de IA

Canal de Denuncias **multiempresa** (SaaS de BeeHives) para empresas chilenas: Ley Karin (21.643), delitos
(Ley 20.393 / 21.595), datos personales (Ley 21.719) y normativa interna. Documentación para humanos: `README.md`.
Seguridad: `SECURITY.md` (para clientes) y `docs/seguridad-tecnica.md` (detalle interno y checklist de producción).

**Idioma:** la interfaz, los mensajes de error, los comentarios del código y la documentación están en **español
(Chile)**. Mantén ese idioma. Los identificadores del código van en inglés.

---

## Stack

| Parte | Tecnología |
|---|---|
| Backend | Node 24, Express 5, TypeScript (ESM, `tsx` + nodemon en desarrollo), `pg`, `zod`, `jsonwebtoken`, `bcryptjs`, `helmet`, `nodemailer`, AWS SDK S3 |
| Frontend | React 19, Vite, Tailwind CSS v4, react-router 7, TypeScript |
| Base de datos | PostgreSQL 17 (Docker en desarrollo, Amazon RDS en producción) |
| Archivos | Carpeta local `./storage` (desarrollo) o Amazon S3 (producción) |
| Correo | SMTP (Mailpit en desarrollo) |

## Ejecutar y verificar

```bash
cp .env.example .env            # primera vez
docker compose up -d --build    # db, backend, frontend, pgadmin, mailpit
docker compose logs -f backend
```

- App: http://localhost:5173 · Consola: `/admin/login` · Empresa: `/{slug}/login` · Portal: `/{slug}/denuncias`
- Correos de desarrollo: http://localhost:8025 · pgAdmin: http://localhost:5050
- Tras agregar dependencias npm: `docker compose up -d --build -V`.

**No hay suite de pruebas en el repositorio.** Para validar cambios:

```bash
docker compose exec -T backend npx tsc --noEmit      # backend
cd Frontend && npx tsc -b && npx eslint src && npm run build
```

Para pruebas de extremo a extremo se han usado scripts temporales (fetch + puppeteer-core con Edge) contra una
empresa temporal que luego se elimina. **Nunca pruebes sobre empresas reales.**

## Estructura

```
Backend/
  migrations/global/NNN_*.sql   → base global (canal_global)
  migrations/tenant/NNN_*.sql   → cada base de empresa (tenant_<slug>)
  src/index.ts                  → app Express (helmet, CORS, límites de body, rutas)
  src/bootstrap.ts              → migra todo al arrancar y crea el primer global_admin desde .env
  src/config.ts                 → TODA la configuración (variables de entorno)
  src/db/                       → pools (uno por empresa) y runner de migraciones
  src/middleware/auth.ts        → requireRole: sesión, rol activo, revocación, CSRF
  src/routes/                   → admin (consola), tenant (/api/t/:slug), auth-flow (login/2FA/recuperación),
                                  channel (config del client_admin), cases (gestión), public (portal), mail (SMTP)
  src/services/                 → lógica de negocio (ver abajo)
  src/storage/                  → abstracción local/S3 y validación de rutas
Frontend/
  src/App.tsx                   → rutas
  src/lib/                      → api.ts (fetch), session.ts, tipos y etiquetas
  src/components/               → ui.tsx (Button, Field, Panel, Modal, Alert…), layouts, LoginCard
  src/pages/                    → consola (raíz), channel/ (panel de empresa), portal/ (denunciante)
  nginx.conf, security-headers.ts → cabeceras de seguridad (producción / Vite)
```

Servicios clave (`Backend/src/services/`):

| Archivo | Qué hace |
|---|---|
| `cases.ts` | Denuncias: visibilidad por rol, acciones del flujo (`applyCaseAction`, en transacción con `FOR UPDATE`), portal, seguimiento del denunciante |
| `procedures.ts` | Hitos y plazos por marco legal (Ley Karin, 20.393, 21.719, interna) |
| `flows.ts` | Plantillas de flujo editables por empresa (versionadas) |
| `calendar.ts` | Días hábiles de Chile (feriados 2025–2027: **actualizar cada año**) |
| `channel.ts` | Usuarios, áreas, categorías y ajustes de la empresa |
| `auth.ts`, `mfa.ts`, `totp.ts`, `session-cookie.ts`, `password-reset.ts` | Autenticación, 2FA, sesión y recuperación |
| `mail.ts`, `mail-settings.ts` | Envío de correo con respaldo empresa → plataforma → .env |
| `audit.ts`, `audit-maintenance.ts` | Auditoría particionada por mes y archivado |
| `secrets.ts` | Cifrado AES-256-GCM de secretos |

## Arquitectura multiempresa

- `canal_global`: `global_admins`, `tenants` (catálogo con `db_name`/`db_host`), `audit_events`, `platform_settings`.
- Una base **por empresa** (`tenant_<slug>`): usuarios, áreas, categorías, denuncias, mensajes, ajustes.
- Las rutas `/api/t/:slug/...` resuelven la empresa (`req.tenant`) y usan **su** pool (`tenantPool(tenant)`).
  Nunca consultes la base de otra empresa ni mezcles datos entre empresas.
- **Migraciones:** se aplican solas al arrancar el backend (global y en todas las empresas). nodemon reinicia el
  backend con cualquier cambio en `src/`, así que **una migración nueva se aplica apenas guardas cualquier archivo de
  `src`**. Reglas:
  - Nunca edites una migración ya aplicada: crea la siguiente (`NNN_descripcion.sql`).
  - Pruébala antes con `BEGIN; …; ROLLBACK;` vía `docker compose exec -T db psql` en cada base.
  - Escríbela antes de tocar `src/`.

## Roles

| Rol | Ámbito | Notas |
|---|---|---|
| `global_admin` | Consola BeeHives | Empresas, equipo, auditoría, SMTP de la plataforma |
| `client_admin` | Empresa | Configura el canal (usuarios, áreas, categorías, portal, marca, correo, flujos). **No ve denuncias** |
| `case_manager` | Empresa | Gestiona denuncias de sus categorías/área; tareas y extensiones de plazo |
| `investigator` | Empresa | Solo casos asignados |
| `resolver` | Empresa | Aprueba o rechaza cierres |
| `auditor` | Empresa | Ve todo sin contenido identificable; registro de accesos |

Una persona puede tener varios roles; la sesión lleva el **rol activo** y los permisos se evalúan con él. Quien está
involucrado en un caso (conflicto de interés) no lo ve con ningún rol.

## Invariantes que no se deben romper

1. **Anonimato del denunciante:** en las rutas públicas (`routes/public.ts`) no guardes IP, user-agent ni huellas;
   no llames a `audit()`; no pongas cookies; respuestas `no-store` y `no-referrer`; sin recursos de terceros en el
   frontend (fuentes propias con `@fontsource`, nada de CDNs ni analítica).
2. **Plazos legales inmutables:** Ley Karin no es editable; los hitos con `legal: true` no se extienden. Solo los
   plazos de referencia, pasos de la empresa y tareas (`legal: false`) admiten extensión, siempre con motivo.
3. **Ley Karin no admite denuncias anónimas** (exige nombre, RUT y correo) ni desestimación.
4. **Sesiones:** el token del equipo va en cookie HttpOnly (`cd_admin` o `cd_t_<slug>`). No lo guardes en
   `localStorage` (solo el marcador `"cookie"`). Las peticiones con cookie que modifican datos pasan la verificación
   de `Origin` (CSRF). Scripts/integraciones: login con `X-Session-Mode: bearer` y `Authorization: Bearer`.
5. **SQL siempre parametrizado** (`$1, $2…`); identificadores con `pg.escapeIdentifier`.
6. **Validación con zod** en toda entrada; errores de usuario con `HttpError(status, mensaje, código)`.
7. **Secretos cifrados** (`encryptSecret` / `encryptSetting`); contraseñas con bcrypt; claves de seguimiento y
   códigos solo como hash. Nunca devuelvas un secreto a la interfaz.
8. **SMTP de empresas:** solo servidores públicos y puertos de correo (protección SSRF en `mail-settings.ts`).
9. **Auditoría:** toda acción administrativa y todo acceso a una denuncia se registra (`audit()`); cada acción de
   un caso deja evento en `case_events`.
10. Cambios de flujo de empresa aplican solo a denuncias **nuevas** (versión guardada en `cases.flow_template_id`).

## Convenciones

- Sigue el estilo del archivo que editas: comentarios breves en español que explican el **porqué**.
- Frontend: componentes de `components/ui.tsx`; colores con tokens de Tailwind del tema (`accent`, `highlight`,
  `nav`…), que la marca de cada empresa sobrescribe. Diseño responsivo (celular incluido, sin desborde horizontal).
- Nuevas acciones de caso: agregarlas a `CASE_ACTIONS` y `ACTION_SCHEMAS` (backend), `CaseAction`, `ACTION_UI` y
  `CaseActionDialog` (frontend), y a `AuditAction` + `audit-labels.ts`.
- Documenta las funciones nuevas en `README.md` (y en `docs/seguridad-tecnica.md` si afectan la seguridad).
- No subas `.env`, `storage/` ni datos reales. El repositorio es **público**.

## Entorno de desarrollo (Windows)

- Git Bash falla con heredocs muy largos: para ediciones grandes usa archivos o las herramientas de edición.
- Si el puerto 5432 está ocupado por un PostgreSQL de Windows: `DB_EXPOSED_PORT=5433` en `.env`.
- PostgreSQL, pgAdmin, la API directa (4000) y Mailpit solo escuchan en `127.0.0.1`; la app (5173) también en la red
  local para probar desde el celular.
- Límites de intentos en memoria: `docker compose restart backend` los reinicia entre pruebas.
