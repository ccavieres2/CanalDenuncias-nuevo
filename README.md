# Canal de Denuncias

Multi-tenant con **una base de datos por empresa** en el mismo servidor PostgreSQL
(hoy en Docker, después en RDS).

```
PostgreSQL (Docker hoy / RDS mañana)
├── canal_global        → global_admins + tenants (catálogo: slug, nombre, db_name, db_host, estado)
├── tenant_upshield     → users (client_admin) … y más adelante las denuncias
└── tenant_otra_empresa → …
```

## Levantar el proyecto

Requisitos: Docker Desktop.

```bash
cp .env.example .env
docker compose up -d --build
```

| Qué | URL |
|---|---|
| Admin global | http://localhost:5173/admin/login |
| Empresa | http://localhost:5173/{slug}/login |
| API | http://localhost:4000/api/health |
| PostgreSQL | localhost:5432 (usuario/clave del `.env`) |
| pgAdmin | http://localhost:5050 (servidor ya registrado; pide la clave `DB_PASSWORD` la primera vez) |

El primer global_admin se crea solo al arrancar si no existe ninguno
(`GLOBAL_ADMIN_EMAIL` / `GLOBAL_ADMIN_PASSWORD` del `.env`).

Logs: `docker compose logs -f backend`. Borrar todo (incluidas las bases): `docker compose down -v`.

## Cómo funciona

- **Crear empresa** (`POST /api/admin/tenants`): registra el tenant en `canal_global`, ejecuta
  `CREATE DATABASE tenant_<slug>`, aplica `Backend/migrations/tenant/*.sql` y crea el primer client_admin.
  Si algo falla se deshace todo.
- **Login de empresa** (`POST /api/t/:slug/auth/login`): busca el tenant por slug en la base global
  y valida al usuario contra **la base de esa empresa**. El JWT lleva el slug y no sirve en otra empresa.
- **Migraciones**: archivos `.sql` numerados en `Backend/migrations/global` y `Backend/migrations/tenant`.
  Al arrancar, el backend aplica los pendientes a la base global y a **todas** las bases de tenant.
  Para cambiar el esquema de las empresas basta con agregar `002_algo.sql`.

## Inicio de sesión y verificación en dos pasos (2FA)

El 2FA con app de autenticación (TOTP: Google/Microsoft Authenticator, Authy) es **obligatorio** para todos:

1. Email + contraseña → el backend entrega un token intermedio (10 min) que solo sirve para el 2FA.
2. Primera vez: se muestra un QR, se confirma un código y se entregan 8 **códigos de recuperación** (una sola vez).
3. Siguientes veces: se pide el código de 6 dígitos (o un código de recuperación).

- El secreto TOTP se guarda cifrado (AES-256-GCM) con `MFA_ENCRYPTION_KEY`. **No pierdas esa clave**: sin ella nadie puede validar sus códigos.
- Un código ya usado no se acepta de nuevo, y hay un límite de 30 intentos cada 15 minutos por IP.
- Si un client_admin pierde su teléfono, el global_admin puede usar **"Restablecer 2FA"** en la ficha de la empresa.
- Si el global_admin pierde su teléfono y sus códigos, se restablece en la base:
  ```sql
  -- en canal_global
  UPDATE global_admins SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, recovery_codes = '{}'
  WHERE email = 'admin@canal-denuncias.local';
  ```

Después de agregar dependencias con npm, reconstruye con `docker compose up -d --build -V`.

## Consola de administración (equipo BeeHives)

| Sección | Qué permite |
|---|---|
| Resumen | Indicadores, actividad reciente y pendientes (empresas sin admin activo, bases caídas, cuentas sin 2FA). |
| Empresas | Alta con base de datos dedicada, ficha comercial (razón social, RUT, contacto, notas), suspender/reactivar, administradores. |
| Equipo BeeHives | Otros global_admin: agregar, desactivar, restablecer contraseña o 2FA. |
| Auditoría | Bitácora de accesos y acciones (quién, qué, cuándo, IP), con filtros. Tabla `audit_events`, solo inserción. |
| Estado del sistema | Salud de la base central y de cada base de empresa, tamaño y migraciones pendientes. |
| Mi cuenta | Cambiar contraseña y regenerar códigos de recuperación. |

- Las cuentas creadas o reseteadas por un administrador reciben una **contraseña temporal** (se muestra una sola vez)
  y deben cambiarla en su primer ingreso, junto con configurar el 2FA.
- Desactivar una cuenta o cambiar/resetear su contraseña **cierra sus sesiones abiertas** de inmediato.
- Nadie puede desactivarse ni resetearse a sí mismo desde "Equipo", y una empresa no puede quedar sin administradores activos.

## Panel de cada empresa (`/{slug}`)

Roles (columna `users.roles` de cada base de empresa; una persona puede tener varios):

| Rol | Qué hace | Denuncias |
|---|---|---|
| `client_admin` Administrador del canal | Configura usuarios, categorías, portal y reglas | No las ve |
| `case_manager` Gestor | Recibe, clasifica y asigna | Las de sus categorías |
| `investigator` Investigador | Investiga y propone conclusión | Solo las asignadas |
| `resolver` Comité / Resolutor | Aprueba cierres y medidas | Las que llegan a resolución |
| `auditor` Auditor | Revisa trazabilidad | Solo lectura, anonimizadas |

Una persona puede tener **varios roles** (`users.roles`). Al ingresar elige con cuál trabajar (rol activo, va en
el token) y puede cambiarlo desde el menú de usuario; los permisos se evalúan con el rol activo y la auditoría
registra `actor_role`. Modalidades (Reglas de gestión):

- **Simplificada**: una persona puede tener todos los roles; exige un plan ante conflicto de interés (suplente o contacto externo).
- **Completa**: doble aprobación; el administrador y el auditor no pueden tener roles que gestionen denuncias.

Gestores, investigadores y resolutores se acotan a categorías (`user_categories`). Las categorías tienen un
marco legal (`ley_karin`, `ley_20393`, `internal`) que definirá el flujo y los plazos de sus denuncias.

Menús del `client_admin`: Inicio (puesta en marcha y denuncias de ejemplo), Usuarios y roles, Áreas, Categorías,
Portal del denunciante, Reglas de gestión, Auditoría y Mi cuenta.

Los roles que gestionan denuncias comparten la misma bandeja (`/{slug}/cases`) y ficha de denuncia; cambian las
denuncias visibles y las acciones permitidas:

| Rol | Ve | Acciones |
|---|---|---|
| Gestor | Todas las de sus categorías | Asignar, medidas de resguardo, escribir al denunciante |
| Investigador | Solo las asignadas | Medidas, diligencias, escribir, proponer conclusión |
| Resolutor | Por resolver y cerradas de sus categorías | Aprobar o rechazar el cierre |
| Auditor | Todas, sin relato ni identidades | Ninguna (solo lectura) |

Quien está involucrado en una denuncia no la ve con ningún rol. Cada apertura de una denuncia queda en la
auditoría (`case.viewed`). El administrador puede cargar **denuncias de ejemplo** desde su inicio para practicar.

Menú de cada rol (las rutas de otro rol redirigen al inicio):

| Gestor | Investigador | Resolutor | Auditor |
|---|---|---|---|
| Bandeja (`/cases`): todas las denuncias; cada fila muestra su acción («Iniciar revisión» si es nueva, «Asignar» si no tiene investigador) | Mis investigaciones (`/cases`) | Por resolver (`/cases`) | Revisión (`/cases`) |
| Por asignar (`/unassigned`): ya iniciadas y sin investigador, botón «Asignar» que guía los pasos que falten | Plazos (`/deadlines`) | Resueltas (`/resolved`) | Plazos |
| Plazos | Mensajes (`/messages`) | Reportes (`/reports`) | Reportes |
| Mensajes | Documentos (`/resources`) | Documentos | Registro de accesos (`/access-log`) |
| Reportes, Documentos | | | Documentos |

- **Plazos**: vencimientos pendientes de las denuncias abiertas visibles (`GET /cases/deadlines`).
- **Reportes**: indicadores calculados solo con cifras (nunca contenido).
- **Registro de accesos**: eventos `case.*` de la empresa, solo auditor (`GET /cases/access-log`).
- **Documentos del canal**: política publicada, reglas de gestión y guías (`GET /cases/resources`).
- **Mensajes**: conversaciones con los denunciantes y mensajes sin leer (`GET /cases/messages`).

### Portal del denunciante y flujo de una denuncia

Cada empresa tiene su portal público en `/{slug}/denuncias` (sin cuenta). Las denuncias se guardan en la base de esa
empresa (`tenant_<slug>`), con numeración propia.

1. **Denuncia** (`/{slug}/denuncias/nueva`): categoría, relato, cuándo/dónde, personas involucradas, anónima o
   identificada, y aceptación del aviso de privacidad (Ley 21.719). Al enviar se entrega una **clave de seguimiento**
   de 16 caracteres; en la base solo queda su hash SHA-256, por lo que no se puede recuperar. No se guarda la IP.
   - La categoría se elige con un **buscador** (sin tildes y con sinónimos: «sueldo» → Derechos laborales, «coima» →
     cohecho). Las categorías con `asks_detail` («Otro») exigen contar en pocas palabras de qué se trata (`topic_detail`).
   - **Ley Karin** pregunta además quién realizó la conducta (`offender_relation`: jefatura, par, subordinado, tercero u
     otra empresa), si sigue ocurriendo (`ongoing`) y si pide **protección urgente** (`urgent_protection`). La bandeja
     marca «Protección urgente» mientras el caso esté abierto, y al definir el procedimiento se propone la relación
     entre empresas según la respuesta.
2. **Seguimiento** (`/{slug}/denuncias/seguimiento`): con la clave el denunciante ve el estado y conversa con el equipo.
   La clave viaja por POST (nunca en la URL) y hay límite de intentos.
3. **Gestión** (`POST /cases/:id/actions/:accion`, en transacción con la denuncia bloqueada):

| Estado | Gestor | Investigador asignado | Comité |
|---|---|---|---|
| Recibida | Iniciar revisión (envía acuse de recibo), reclasificar, proponer desestimar | — | — |
| En revisión | Asignar investigador, reclasificar, proponer desestimar | — | — |
| En investigación | Reasignar, medidas, aviso a la autoridad, mensajes, notas, conflicto de interés | Diligencias, medidas, mensajes, notas, proponer conclusión | — |
| Por resolver | Medidas, mensajes | Medidas, mensajes | Aprobar el cierre o devolver con observaciones |

En la modalidad completa, quien investigó o propuso no puede resolver el mismo caso. Marcar a un usuario como
involucrado lo excluye del caso; si era el investigador, el caso vuelve a revisión. Los plazos se marcan cumplidos
según las acciones (medidas, aviso a la Dirección del Trabajo, acuse de recibo, conclusión, cierre). Cada acción queda
en la trazabilidad del caso y en la auditoría (`case.<accion>`, sin contenido).

## Procedimientos legales por marco

Cada denuncia calcula su procedimiento según el marco legal de su categoría (`Backend/src/services/procedures.ts`).
Los hitos tienen plazo, fundamento normativo y se registran desde la ficha («Procedimiento legal»). Los días hábiles
excluyen sábados, domingos y feriados (DS 21/2024), contados según la fecha en Chile
(`Backend/src/services/calendar.ts`). **La lista de feriados cubre 2025-2027 y debe actualizarse cada año.**

**Ley Karin (Ley 21.643 y DS 21/2024)**

| Hito | Plazo |
|---|---|
| Medidas de resguardo y derivación al organismo administrador (Ley 16.744) | Inmediatas (el mismo día) |
| Decidir quién investiga (empresa o DT); si el denunciante lo pide, derivar a la DT | 3 días hábiles |
| Investigación interna: aviso a la DT del inicio y medidas | 3 días hábiles |
| Investigación interna: informe final aprobado | 30 días hábiles desde la recepción |
| Envío del informe a la DT | 2 días hábiles desde el término |
| Pronunciamiento de la DT (si no se pronuncia, las conclusiones son válidas) | 30 días hábiles |
| Derivación a la DT (si investiga la DT) | 3 días hábiles |
| Informe de la investigación de la DT | 30 días hábiles desde la derivación |
| Aplicar medidas y sanciones e informar a las partes (cierra la denuncia) | 15 días corridos |
| Subcontratación: informar a la otra empresa (principal, contratista o usuaria) | 3 días hábiles |

- Una denuncia Ley Karin no se puede desestimar. Tras aprobar el informe queda **En seguimiento** hasta aplicar medidas.
- Los hitos se registran en orden: no se registra el pronunciamiento sin el envío del informe, ni las medidas sin el
  pronunciamiento (o sin «venció el plazo», que solo se acepta después de los 30 días hábiles).
- **Identificación obligatoria**: las denuncias Ley Karin no pueden ser anónimas (Ord. DT N° 497/21). La persona
  afectada entrega nombre, RUN (se valida el dígito verificador) y correo personal (art. 11 DS 21/2024); si denuncia un
  tercero, identifica a la persona afectada y su representación (p. ej., poder simple).

**Flujo de denuncias** (`/{slug}/flows`): guía visible para todos los roles de la empresa, con el flujo completo de
cada ley (Ley Karin con investigación interna o de la DT, delitos, datos personales y normativa interna): quién
actúa, qué botón usar, el plazo y en qué estado queda la denuncia.

### Vías de ingreso

Además del portal, el gestor registra en `/{slug}/cases/new` las denuncias que llegan por otras vías:

| Vía | Detalle |
|---|---|
| Directa | Verbal (acta firmada y copia al denunciante), carta o buzón físico, correo, teléfono o intermediario (jefatura, sindicato, comité paritario). Puede recibir clave de seguimiento. |
| Remitida por otra empresa | Subcontratación o servicios transitorios (principal, contratista o usuaria). Agrega el hito de informar a la otra empresa. |
| Detectada internamente | Auditoría, Encargado de Prevención de Delitos o controles. Sin denunciante ni acuse de recibo. |
| Dirección del Trabajo | Denuncia Ley Karin ante la DT: la investiga la DT y la empresa queda en seguimiento. |
| Tribunal, Agencia de Datos, Ministerio Público u otra autoridad | Se registra con el plazo fijado por la autoridad, que aparece como hito «Responder a…». |

El portal muestra también las otras vías configuradas por el administrador (en persona, teléfono y correo) y la vía
ante la Dirección del Trabajo. La mutual o el ISL no reciben denuncias: solo dan atención psicológica.

**Ley 20.393 / 21.595 (delitos)**: acuse en 7 días y respuesta en 3 meses (ISO 37002, referencial) y evaluación de
denuncia al Ministerio Público. **Ley 21.719 (datos personales, vigente desde el 1/12/2026)**: evaluar si hubo
vulneración de seguridad; si la hubo, reportar a la Agencia sin dilaciones indebidas (referencia 72 h) y comunicar
a los titulares cuando corresponda. **Normativa interna**: acuse en 7 días y respuesta en 3 meses.

### Marca de cada empresa

El administrador del canal define en **Marca** (`/{slug}/branding`) el logo (PNG, JPG o WebP de hasta 300 KB; se
valida el tipo real del archivo) y el color principal (debe tener contraste AA con texto blanco). Se aplica solo a esa
empresa: portal de denuncias, pantalla de ingreso y panel. Se guarda en la base de la empresa (`settings.branding`) y
el logo se sirve en `/api/t/{slug}/public/logo`.

### App de autenticación del denunciante

Además de la clave de seguimiento, el denunciante (anónimo o identificado) puede asociar una app de autenticación
(Google o Microsoft Authenticator) al enviar su denuncia o desde el seguimiento. Luego entra con el **código de la
denuncia + el código de 6 dígitos**. El secreto se guarda cifrado; cada código se usa una sola vez; tras 5 intentos
fallidos la denuncia se bloquea 15 minutos (la clave sigue funcionando). La app muestra la cuenta como
«Seguimiento: DEN-…», sin el nombre de la empresa. Al ingresar se entrega una sesión de 30 minutos válida solo para
esa denuncia y esa empresa.

## Archivos (logos y evidencias): carpeta local hoy, S3 en producción

Todo archivo pasa por una sola capa (`Backend/src/storage/`), con la misma estructura en ambos modos. Cada empresa
tiene su propio prefijo, igual que tiene su propia base de datos:

```
<empresa>/branding/logo-<fecha>.png
<empresa>/denuncias/ley-karin/DEN-2026-0001/<id>-<archivo>
<empresa>/denuncias/delitos-ley-20393/…
<empresa>/denuncias/datos-personales-ley-21719/…
<empresa>/denuncias/normativa-interna/…
```

- **Desarrollo** (`STORAGE_DRIVER=local`): carpeta `./storage` del proyecto (montada en `/storage` del backend y
  excluida de git).
- **Producción** (`STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION`): bucket privado. Recomendado: bloquear todo acceso
  público, versionado activado y reglas de ciclo de vida acordes a la conservación de cada empresa. Los objetos se
  guardan cifrados (AES-256, o KMS con `S3_KMS_KEY_ID`). Las credenciales vienen del rol IAM; los archivos solo se
  entregan a través del backend, que valida permisos.
- **Probar S3 en local**: `docker compose --profile s3 up -d s3` (Adobe S3Mock) y en `.env`: `STORAGE_DRIVER=s3`,
  `S3_BUCKET=…`, `S3_ENDPOINT=http://s3:9090`, `S3_FORCE_PATH_STYLE=true`, `AWS_ACCESS_KEY_ID=test`,
  `AWS_SECRET_ACCESS_KEY=test` (el bucket se crea aparte, como en AWS).
- Las claves se validan (sin `..`, sin rutas absolutas) para que una empresa nunca lea o escriba en la carpeta de otra.
- Los logos que estaban guardados dentro de la base (versión anterior) se mueven solos al almacenamiento al arrancar.

## Registros de auditoría: rápidos y baratos

La auditoría sigue en PostgreSQL (`canal_global.audit_events`), pero organizada para crecer sin volverse lenta ni
cara:

- **Tabla particionada por mes** (nativo de PostgreSQL): las consultas recientes leen solo los meses necesarios y los
  meses antiguos se eliminan al instante, sin fragmentar la tabla. Los meses siguientes se crean solos.
- **Archivo automático**: al arrancar y cada 24 horas, los meses anteriores a `AUDIT_HOT_MONTHS` (12 por defecto) se
  exportan comprimidos (JSON por línea + gzip, ~10 veces más livianos) al almacenamiento de archivos:
  `plataforma/auditoria/AAAA/AAAA-MM-<fecha>.jsonl.gz` (carpeta local o S3; en S3 conviene moverlos a Glacier con
  una regla de ciclo de vida). Solo se eliminan de la base después de verificar que el archivo tiene todos los
  eventos. La tabla `audit_archives` indica dónde quedó cada mes.
- **Menos ruido**: «abrió la denuncia» se registra una vez por persona, rol y denuncia cada 30 minutos
  (`AUDIT_CASE_VIEW_WINDOW`).
- La consola BeeHives muestra el estado en **Estado del sistema → Registros de auditoría**.

Prueba de referencia: 300.000 eventos ocupaban 168,8 MB en la base; archivados quedaron en 17,7 MB y la base en
0,5 MB, en 6 segundos.

La trazabilidad de cada denuncia (`case_events`, en la base de cada empresa) es parte del expediente y no se archiva
aquí: se conserva junto con la denuncia.

## Anonimato del denunciante

Una denuncia anónima no deja rastro de quién la hizo:

- **Base de datos**: las denuncias no tienen columnas de IP, navegador ni dispositivo. La clave de seguimiento se
  guarda como huella SHA-256 y el secreto de la app de autenticación, cifrado.
- **Auditoría**: las rutas públicas del portal no escriben en `audit_events` (que sí guarda IP, pero solo del personal).
- **Navegador**: el portal no usa cookies ni `localStorage`/`sessionStorage`; la clave y la sesión viven en memoria.
- **Sin terceros**: las fuentes se sirven desde el propio sitio (`@fontsource`), sin Google Fonts ni analítica. Nunca
  agregar scripts de terceros (analítica, chat, mapas) al portal.
- **Sin caché ni origen**: las respuestas de `/api/t/:slug/public/*` llevan `Cache-Control: no-store` y
  `Referrer-Policy: no-referrer`; la página declara `<meta name="referrer" content="no-referrer">`.
- **Límite de intentos**: usa una huella HMAC de la IP con una clave aleatoria que solo existe en memoria y cambia en
  cada reinicio; nunca se escribe la IP.
- **Registros del servidor**: el backend no registra solicitudes.

**En producción (AWS)**, desactivar o anonimizar los registros de acceso de la infraestructura para el portal
(`/*/denuncias*` y `/api/t/*/public/*`): registros de acceso del balanceador (ALB), de CloudFront, de WAF y de
cualquier proxy (Nginx). Esos servicios guardan la IP por defecto y quedan fuera de la aplicación.

Lo que depende del denunciante (el portal se lo explica): no usar el computador ni el Wi-Fi de la empresa y no
incluir en el relato datos que lo identifiquen. Cuando se agreguen evidencias, se deberán quitar sus metadatos
(ubicación GPS de las fotos, autor de los documentos) antes de guardarlas.

## Pasar a RDS

No hay que tocar código, solo variables de entorno del backend:

```env
DB_HOST=mi-instancia.xxxxx.us-east-1.rds.amazonaws.com
DB_USER=<usuario maestro o uno con CREATEDB>
DB_PASSWORD=...
DB_SSL=true
```

El backend crea `canal_global` si no existe. Cada tenant guarda su `db_host`, así que más adelante
se pueden crear empresas nuevas en otra instancia (`TENANT_DB_HOST`) sin mover las existentes.
