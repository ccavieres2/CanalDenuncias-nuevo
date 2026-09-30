# Seguridad del Canal de Denuncias — documento técnico (uso interno)

Descripción de las medidas de seguridad de la plataforma **Canal de Denuncias (BeeHives)**, cómo están
implementadas en el código y qué queda pendiente antes de operar con clientes reales.

> Estado al **29 de septiembre de 2026**. Cada medida indica dónde está en el código para poder revisarla.
> Las medidas marcadas como verificadas se probaron de forma automatizada (ver [Verificación](#11-verificación-realizada)).

---

## Índice

1. [Resumen](#1-resumen)
2. [Arquitectura y separación entre empresas](#2-arquitectura-y-separación-entre-empresas)
3. [Autenticación del equipo](#3-autenticación-del-equipo)
4. [Sesiones](#4-sesiones)
5. [Autorización (roles y visibilidad)](#5-autorización-roles-y-visibilidad)
6. [Denunciante: anonimato y acceso a su denuncia](#6-denunciante-anonimato-y-acceso-a-su-denuncia)
7. [Protección de la aplicación web](#7-protección-de-la-aplicación-web)
8. [Datos, cifrado y secretos](#8-datos-cifrado-y-secretos)
9. [Correo saliente (SMTP)](#9-correo-saliente-smtp)
10. [Auditoría y trazabilidad](#10-auditoría-y-trazabilidad)
11. [Verificación realizada](#11-verificación-realizada)
12. [Configuración obligatoria para producción](#12-configuración-obligatoria-para-producción)
13. [Pendientes y limitaciones conocidas](#13-pendientes-y-limitaciones-conocidas)
14. [Reporte de vulnerabilidades](#14-reporte-de-vulnerabilidades)

---

## 1. Resumen

| Área | Medida principal |
|---|---|
| Empresas | Una base de datos PostgreSQL **separada por empresa**; tokens y cookies amarrados a cada empresa |
| Acceso del equipo | Contraseña (bcrypt) + **2FA obligatorio** (app de autenticación) para todas las cuentas |
| Sesiones | Cookie **HttpOnly + SameSite=Strict** (inaccesible para JavaScript), con verificación de origen contra CSRF |
| Permisos | 5 roles por empresa; el administrador del canal **no ve el contenido** de las denuncias |
| Denunciante | Anonimato real: sin IP, sin cookies, sin almacenamiento en su dispositivo, sin recursos de terceros |
| Web | CSP estricta, bloqueo de iframes, HSTS, `nosniff`, `no-referrer`; consultas SQL parametrizadas |
| Datos sensibles | Secretos 2FA y contraseñas SMTP cifrados (AES-256-GCM); claves de seguimiento y códigos solo como hash |
| Infraestructura | TLS verificado hacia la base de datos; servicios internos solo accesibles desde el propio servidor |
| Trazabilidad | Auditoría de accesos y cambios, archivada y verificada; bitácora por denuncia |

---

## 2. Arquitectura y separación entre empresas

- **Backend:** Node.js + Express 5 + TypeScript. **Frontend:** React 19 (Vite). **Base de datos:** PostgreSQL 17
  (Amazon RDS en producción). **Archivos:** carpeta local en desarrollo, Amazon S3 privado en producción.
- **Base global** (`canal_global`): catálogo de empresas, equipo BeeHives, auditoría y ajustes de la plataforma.
  **Una base por empresa** (`tenant_<slug>`): sus usuarios, denuncias, mensajes y configuración.
- Cada petición a `/api/t/<empresa>/…` se resuelve contra la base de **esa** empresa
  (`Backend/src/routes/tenant.ts`). Una empresa suspendida o inexistente responde 404 igual que una que no existe.
- **Tokens amarrados a su ámbito:** una sesión, código de verificación o token de recuperación emitido para una
  empresa no sirve en otra ni en la consola de la plataforma, y viceversa (`Backend/src/middleware/auth.ts`,
  `verifyMfaToken`/`verifyResetToken` en `Backend/src/services/auth.ts`). *Verificado.*
- **Archivos por empresa:** `<empresa>/branding/…` y `<empresa>/denuncias/<ley>/<código>/…`. Las rutas se validan
  para impedir salir de la carpeta (`assertSafeKey`, `Backend/src/storage/keys.ts`). En S3 se cifran del lado del
  servidor (AES-256 o KMS).

---

## 3. Autenticación del equipo

Aplica igual a la consola de la plataforma (global_admin) y al panel de cada empresa (`Backend/src/routes/auth-flow.ts`).

**Contraseñas**
- Guardadas con **bcrypt, factor 12**; no se pueden recuperar, solo verificar (`Backend/src/services/auth.ts`).
- Política: mínimo 10 caracteres, con al menos una letra y un número (`Backend/src/services/passwords.ts`).
- Cuando el correo no existe se compara igual contra un hash ficticio, para que el tiempo de respuesta no revele
  qué correos están registrados.
- Las contraseñas temporales (cuentas nuevas o reseteadas por un administrador) obligan a cambiarlas al ingresar.

**Verificación en dos pasos (2FA) obligatoria**
- App de autenticación estándar (TOTP, RFC 6238): Google/Microsoft Authenticator, Authy, etc.
- El secreto se guarda **cifrado con AES-256-GCM** (`Backend/src/services/secrets.ts`).
- Un código ya usado no se acepta otra vez (anti-replay, `totp_last_step`).
- 8 **códigos de recuperación** de un solo uso, guardados como hash.
- Tras la contraseña se entrega un token intermedio de **10 minutos** que solo sirve para completar el 2FA.

**Recuperación de contraseña por correo** (`Backend/src/services/password-reset.ts`)
- Código de 6 dígitos, **vence en 15 minutos**, un solo uso, **se anula a los 5 intentos**.
- Solo se guarda un HMAC del código; la respuesta es idéntica exista o no la cuenta (no permite descubrir correos).
- Límite: 1 código por minuto y 5 por hora por cuenta, y 10 solicitudes por IP cada 15 minutos.
- Al cambiarla se cierran todas las sesiones y se envía un aviso por correo.
- **No omite el 2FA:** para entrar sigue siendo necesaria la app de autenticación.

**Límite de intentos (fuerza bruta):** 30 intentos cada 15 minutos por IP en ingreso, 2FA y recuperación.

---

## 4. Sesiones

(`Backend/src/services/session-cookie.ts`, `Frontend/src/lib/session.ts`)

- La sesión es un JWT firmado (HS256) con vencimiento de **8 horas** (`JWT_EXPIRES_IN`).
- Viaja en una **cookie HttpOnly**: el JavaScript de la página no puede leerla, por lo que ni una eventual falla XSS
  permitiría robar la sesión. En el navegador solo queda un marcador sin valor (`"cookie"`). *Verificado.*
- Atributos: `HttpOnly`, `SameSite=Strict`, `Secure` en producción (HTTPS) y **una cookie por ámbito**, que solo
  viaja a su parte de la API (`cd_admin` → `/api/admin`, `cd_t_<empresa>` → `/api/t/<empresa>`).
- **Protección CSRF:** toda petición que modifica datos y se autentica con la cookie debe traer un encabezado
  `Origin` igual al del propio sitio (o a `APP_URL`/`CORS_ORIGIN`); si no, se rechaza con 403. *Verificado.*
- **Revocación inmediata** en cada petición (se consulta la base): cuenta desactivada, rol quitado o contraseña
  cambiada después de emitida la sesión → la sesión deja de valer al instante.
- **Cerrar sesión** borra la cookie en el servidor.
- Integraciones y scripts pueden usar `Authorization: Bearer` pidiendo el token con `X-Session-Mode: bearer`
  (no usan cookies, así que no aplica CSRF).
- Las sesiones guardadas por versiones anteriores en `localStorage` se descartan automáticamente.

---

## 5. Autorización (roles y visibilidad)

(`Backend/src/middleware/auth.ts`, `Backend/src/services/cases.ts`)

| Rol | Puede |
|---|---|
| `global_admin` (BeeHives) | Crear y suspender empresas, gestionar su equipo, ver auditoría y estado del sistema |
| `client_admin` | Configurar el canal de su empresa (usuarios, áreas, categorías, portal, marca, correo). **No ve denuncias** |
| `case_manager` | Recibir, clasificar, asignar y gestionar denuncias; mensajes con el denunciante |
| `investigator` | Investigar las denuncias que tiene asignadas |
| `resolver` | Aprobar o rechazar resoluciones |
| `auditor` | Revisar, sin modificar, y ver el registro de accesos |

- Los permisos se evalúan con el **rol activo** de la sesión y se verifican en cada petición contra la base.
- **Visibilidad por área y categoría:** cada persona ve solo las denuncias de las categorías que le corresponden.
- **Conflicto de interés:** quien participó en un caso no puede resolverlo en la modalidad completa.
- Acciones sobre una denuncia en transacción con la fila bloqueada (`FOR UPDATE`), para evitar dobles cambios.

---

- **Plan de la empresa** (`services/plans.ts`): cada ruta que crea o configura algo sujeto al plan lo verifica en el
  servidor (`requireFeature`, `requireFramework`, `requireBelowLimit`); el frontend solo lo oculta. El plan se lee en
  cada petición, así que un cambio aplica de inmediato. Bajar de plan no borra datos ni corta la gestión de denuncias
  en curso (plazos legales).

## 6. Denunciante: anonimato y acceso a su denuncia

**Anonimato** (`Backend/src/routes/public.ts`, `Frontend/index.html`) — *verificado de extremo a extremo*
- **No se guarda la IP**, el navegador ni ninguna huella del dispositivo, ni en la denuncia, ni en los mensajes, ni en
  la auditoría, ni en los registros del servidor.
- **Sin cookies ni almacenamiento** en el dispositivo del denunciante (su sesión de seguimiento vive solo en memoria).
- **Sin recursos de terceros:** fuentes e imágenes se sirven desde el propio sitio (no hay Google Fonts ni analítica).
- `Referrer-Policy: no-referrer` y `Cache-Control: no-store` en todas las respuestas del portal.
- El límite de intentos usa una **huella HMAC irreversible** de la IP con una clave aleatoria que cambia en cada
  reinicio: no se puede reconstruir la IP.
- El portal explica qué no se registra y da consejos para cuidar el anonimato.

**Seguimiento de la denuncia**
- **Clave de seguimiento** de 16 caracteres aleatorios, guardada solo como **hash SHA-256** (no se puede recuperar).
  Viaja por POST, nunca en la URL.
- Alternativa: **app de autenticación** (código de la denuncia + código de 6 dígitos). Bloqueo de 15 minutos tras
  5 intentos fallidos. Secreto cifrado con AES-256-GCM.
- La sesión de seguimiento dura 30 minutos y solo da acceso a esa denuncia.
- Límites por conexión: 10 denuncias por hora y 40 intentos de seguimiento cada 15 minutos.

**Ley Karin:** no admite denuncias anónimas (art. 11 del DS 21/2024): exige nombre, RUT (validado con dígito
verificador) y correo.

---

## 7. Protección de la aplicación web

**Cabeceras de seguridad**

| Cabecera | Aplicación web (nginx / Vite) | API (helmet) |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'` (producción, sin scripts en línea), `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` | `default-src 'none'; frame-ancestors 'none'` |
| `X-Frame-Options` | `DENY` | `SAMEORIGIN` + CSP |
| `Strict-Transport-Security` | `max-age=31536000` (efectivo por HTTPS) | igual |
| `X-Content-Type-Options` | `nosniff` | `nosniff` |
| `Referrer-Policy` | `no-referrer` | `no-referrer` |
| `Permissions-Policy` | cámara, micrófono, ubicación, pagos y USB desactivados | — |
| `Cross-Origin-*` | `Cross-Origin-Opener-Policy: same-origin` | `Cross-Origin-Resource-Policy: same-origin` |

Archivos: `Frontend/nginx.conf` (producción), `Frontend/security-headers.ts` (Vite), `Backend/src/index.ts` (API).
En desarrollo la CSP permite scripts en línea porque Vite los necesita para la recarga automática; la imagen de
producción no. `X-Powered-By` y la versión de nginx no se exponen.

**Otras defensas**
- **Inyección SQL:** todas las consultas usan parámetros (`$1, $2…`); los nombres de bases se escapan con
  `escapeIdentifier`.
- **XSS:** React escapa todo el contenido y no se usa HTML sin escapar (`dangerouslySetInnerHTML`). La CSP de
  producción bloquea además cualquier script que no venga del propio sitio.
- **Validación de entrada** con esquemas (zod) en todas las rutas; tamaño máximo de petición 100 KB (450 KB solo
  para el logo). Un exceso responde 413 sin afectar el servidor.
- **Archivos subidos (logo):** se valida el tipo real por su contenido (no por la extensión), máximo 300 KB.
- **Evidencias del denunciante** (`services/case-files.ts`): lista cerrada de formatos, con la extensión y la firma
  del contenido que deben coincidir (sin ejecutables, HTML ni SVG); máximo 10 MB por archivo (nginx admite 11 MB solo
  en esa ruta), 20 archivos y 100 MB por denuncia, con la denuncia bloqueada (`FOR UPDATE`) al validar los límites.
  El nombre se limpia de rutas y caracteres de control; la clave de almacenamiento se genera en el servidor
  (`caseFileKey` + `assertSafeKey`). Límite de 30 subidas por hora por conexión (huella en memoria, sin guardar la IP).
  La descarga exige ver la denuncia con el rol activo y un rol con acceso al contenido (el auditor no descarga), se
  entrega como `attachment` con `nosniff` y `no-store`, y queda auditada. Se guarda la huella SHA-256 de cada archivo.
  Pendiente: análisis antivirus y eliminación de metadatos (EXIF) de las fotos; el portal advierte al denunciante
  anónimo que revise que sus archivos no lo identifiquen.
- **Errores:** no se devuelven trazas ni detalles internos al usuario.

---

## 8. Datos, cifrado y secretos

| Dato | Cómo se guarda |
|---|---|
| Contraseñas | bcrypt (factor 12) |
| Secretos 2FA (equipo y denunciantes) | AES-256-GCM con `MFA_ENCRYPTION_KEY` |
| Contraseñas SMTP | AES-256-GCM con `SETTINGS_ENCRYPTION_KEY` (o clave derivada) |
| Claves de seguimiento, códigos de recuperación | Hash SHA-256 |
| Códigos de recuperación de contraseña | HMAC-SHA256 |
| Contenido de denuncias y mensajes | Texto en la base (cifrado en disco de RDS; ver pendientes) |
| Archivos | S3 privado con cifrado del lado del servidor |

- **Conexión a la base cifrada y verificada:** con `DB_SSL=true` se valida el certificado del servidor contra la CA
  indicada en `DB_SSL_CA_FILE` (en RDS, el bundle de Amazon), incluido el nombre del servidor
  (`Backend/src/db/pool.ts`). Desactivarlo exige `DB_SSL_VERIFY=false` explícito y deja una advertencia en el
  registro. *Verificado.*
- **Secretos** en variables de entorno (`.env`, excluido del repositorio). En producción: AWS Secrets Manager.
- **Servicios internos** (PostgreSQL, pgAdmin, API directa, buzón de correo de desarrollo) solo escuchan en
  `127.0.0.1` del servidor; no quedan expuestos a la red.

---

## 9. Correo saliente (SMTP)

(`Backend/src/services/mail-settings.ts`, `Backend/src/services/mail.ts`)

- SMTP por defecto de la plataforma y, opcionalmente, uno propio por empresa. Contraseñas cifradas; **nunca se
  devuelven a la interfaz**.
- **Protección de la red interna (SSRF):** una empresa solo puede usar servidores públicos y puertos de correo
  (25, 465, 587, 2525). La dirección se valida al guardar **y al enviar**, conectándose a la IP ya validada.
- Certificado TLS del servidor de correo verificado por defecto; STARTTLS o SSL/TLS obligatorios si hay contraseña.
- Si el SMTP de una empresa falla, el correo sale por el de la plataforma (nadie queda sin su código) y la falla se
  informa al administrador. Límite de 10 correos de prueba cada 15 minutos.

---

## 10. Auditoría y trazabilidad

(`Backend/src/services/audit.ts`, `Backend/src/services/audit-maintenance.ts`)

- Se registran ingresos (correctos y fallidos), 2FA, cambios y recuperaciones de contraseña, cambios de rol,
  administración de empresas y usuarios, configuración (incluido el correo) y cada acceso a una denuncia.
- Cada denuncia tiene además su **bitácora** de acciones y un **registro de accesos** visible para el auditor.
- La auditoría está **particionada por mes**; los meses antiguos se exportan comprimidos a almacenamiento privado,
  se **verifican** contra la base y solo entonces se eliminan de ella.
- Las acciones del portal del denunciante **no** se auditan con datos de conexión, para preservar el anonimato.

---

## 11. Verificación realizada

Pruebas automatizadas (API y navegador real) ejecutadas sobre empresas temporales, eliminadas después:

| Prueba | Resultado |
|---|---|
| Sesión en cookie HttpOnly: JavaScript no puede leerla; en `localStorage` solo queda el marcador | ✔ |
| CSRF: petición desde otro sitio o sin origen → 403; desde la propia app → OK | ✔ |
| La cookie de una empresa no sirve en otra ni en la consola | ✔ |
| Cerrar sesión elimina la cookie; sesiones antiguas en `localStorage` se descartan | ✔ |
| Cabeceras de seguridad en la API, en desarrollo y en la imagen de producción; sin violaciones de CSP | ✔ |
| TLS a la base: rechaza certificado no confiable, CA ajena y nombre de servidor distinto; acepta la CA correcta | ✔ |
| Recuperación de contraseña: códigos de un uso, vencimiento, 5 intentos, no revela correos, mantiene el 2FA | ✔ |
| SMTP: bloquea servidores internos, metadatos de AWS, IP privadas y puertos no de correo; contraseña cifrada | ✔ |
| Anonimato: sin IP, navegador, cookies ni terceros en base, auditoría y registros | ✔ |

---

## 12. Configuración obligatoria para producción

- [ ] Generar valores **nuevos y aleatorios** para `JWT_SECRET`, `MFA_ENCRYPTION_KEY` y `SETTINGS_ENCRYPTION_KEY`
      (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) y guardarlos en AWS Secrets
      Manager. **No perder** `MFA_ENCRYPTION_KEY` ni `SETTINGS_ENCRYPTION_KEY` (sin ellas no se pueden leer los
      secretos 2FA ni las contraseñas SMTP).
- [ ] `APP_URL=https://…` (activa la cookie `Secure`) y `CORS_ORIGIN` con el dominio real.
- [ ] Servir solo por **HTTPS** (balanceador o CloudFront con certificado) y redirigir HTTP a HTTPS.
- [ ] Frontend con la imagen de producción (`Frontend/Dockerfile`, target `prod`: nginx con cabeceras estrictas).
- [ ] Backend con la imagen de producción (`Backend/Dockerfile`, target `prod`) y `TRUST_PROXY` = número de proxies.
- [ ] Base de datos: `DB_SSL=true` y `DB_SSL_CA_FILE` con el bundle de RDS; RDS en subred privada, cifrado en
      disco (KMS) y respaldos automáticos.
- [ ] `STORAGE_DRIVER=s3` con bucket privado (bloqueo de acceso público) y cifrado.
- [ ] No desplegar pgAdmin ni Mailpit. Mantener `ALLOW_PRIVATE_SMTP=false`.
- [ ] Desactivar registros de acceso con IP del portal en la infraestructura (ALB, CloudFront, WAF) o excluir sus
      rutas, para mantener el anonimato del denunciante.
- [ ] Cambiar la contraseña inicial del global_admin (`GLOBAL_ADMIN_PASSWORD`).
- [ ] Verificar el dominio del remitente de correo (SPF, DKIM, DMARC).

---

## 13. Pendientes y limitaciones conocidas

**Recomendado antes de clientes reales**
1. **Un usuario de PostgreSQL por empresa.** Hoy todas las bases usan el mismo usuario; si su contraseña se filtrara,
   daría acceso a todas. Propuesta: usuario por empresa con contraseña aleatoria cifrada y usuario administrador
   separado para crear empresas y migrar.
2. **Cifrado a nivel de campo** del relato y los mensajes de las denuncias (AWS KMS), además del cifrado en disco.
3. **Pruebas de penetración** externas y revisión legal del tratamiento de datos (Ley 21.719, vigente desde el
   1 de diciembre de 2026).

**A futuro**
4. **Límite de intentos compartido** (por ejemplo, Redis): hoy vive en la memoria de cada instancia del backend.
5. **Evidencias adjuntas** (implementadas; ver sección 7): falta eliminar metadatos (EXIF/GPS) de las fotos y
   analizarlas con antivirus (por ejemplo, ClamAV o Amazon GuardDuty Malware Protection for S3).
6. **Pruebas automáticas en el repositorio** y escaneo de dependencias (`npm audit`, Dependabot) en CI.
7. **Revocación de sesiones por lista** (cerrar sesión en todos los dispositivos sin cambiar la contraseña).
8. **OAuth2 para SMTP** (Microsoft 365 / Google) en lugar de contraseñas de aplicación.
9. **Feriados** del cálculo de plazos legales: actualizar la lista cada año (hoy cubre 2025–2027).

---

## 14. Reporte de vulnerabilidades

Si encuentras una vulnerabilidad, repórtala de forma privada al equipo de BeeHives (no abras un *issue* público):
incluye la descripción, los pasos para reproducirla y el impacto. Nos comprometemos a confirmar la recepción y a
informar la corrección.

<!-- Definir aquí el correo o canal oficial de seguridad de BeeHives. -->
