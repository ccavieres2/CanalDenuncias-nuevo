# Canal de Denuncias en un EC2 para demos (Docker + HTTPS)

Guía paso a paso para levantar el canal en **un EC2 con Ubuntu** (IP pública `98.81.72.190`), todo en Docker como en local, con
**conexión segura (HTTPS)** usando solo la IP, sin dominio todavía.

```
Internet ─► Caddy (80/443, HTTPS automático) ─► nginx (app + /api) ─► backend ─► PostgreSQL
                                                                         └─► Mailpit (correos de la demo)
```

- **HTTPS real con la IP:** el canal queda en `https://98.81.72.190` con un **certificado de Let's Encrypt para la IP**
  (disponible desde 2026; dura unos 6 días y Caddy lo renueva solo). **Sin advertencias** en el navegador.
- **Correos de la demo:** quedan atrapados en **Mailpit** (no salen a internet) y se ven por un túnel SSH.
- **Más adelante, con el dominio de cPanel:** se cambian 4 líneas del `.env` (ver [paso 9](#9-cuando-tengan-el-dominio-cpanel)).

> **Solo para demos.** No cargar denuncias ni datos reales: la base y los archivos quedan dentro del EC2. Para
> clientes reales, ver la sección 12 de [seguridad-tecnica.md](seguridad-tecnica.md) (RDS, S3, SES).

---

## 0. Lo que necesitas

- EC2 con **Ubuntu** (24.04 recomendado), tipo **t3a.small**, disco de **20 GB o más**, IP pública `98.81.72.190`.
- La llave `.pem` de la instancia.
- Acceso a GitHub con permiso de lectura en `ACME-BEEHIVES/canaletica`.

---

## 1. Dirección del canal

| IP pública del EC2 | Dirección del canal |
|---|---|
| `98.81.72.190` | **https://98.81.72.190** |

> **Ojo, sin Elastic IP:** la IP pública **se mantiene al reiniciar** la instancia (*Reboot*), pero **cambia si la
> detienes y la vuelves a iniciar** (*Stop* → *Start*). Si eso pasa, actualiza `DOMAIN`, `APP_URL` y `CORS_ORIGIN`
> en el `.env` con la IP nueva y ejecuta `canal up -d`. Para demos, mejor usar *Reboot* y no *Stop*.

---

## 2. Firewall (Security Group)

**EC2 → Instances →** tu instancia **→ pestaña Security → Security groups →** el grupo **→ Edit inbound rules:**

| Tipo | Puerto | Origen | Para qué |
|---|---|---|---|
| SSH | 22 | **My IP** | Administrar el servidor (solo desde tu IP) |
| HTTP | 80 | `0.0.0.0/0` y `::/0` | Obtener el certificado y redirigir a HTTPS |
| HTTPS | 443 | `0.0.0.0/0` y `::/0` | El canal |

**No abras otros puertos** (5432, 4000, 8025, 5050…): la base, la API y Mailpit quedan internos.

> Si cambias de red (otra casa u oficina), actualiza la regla de SSH con tu IP nueva («My IP»).

---

## 3. Entrar y preparar el servidor

Desde tu PC (PowerShell o Git Bash), en la carpeta donde está la llave:

```bash
ssh -i tu-llave.pem ubuntu@98.81.72.190
```

Ya dentro del servidor:

```bash
# Sistema al día y hora de Chile
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone America/Santiago

# Memoria de intercambio (swap) de 2 GB: la t3a.small tiene 2 GB y compilar las imágenes la necesita
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit
```

Vuelve a entrar (`ssh -i tu-llave.pem ubuntu@98.81.72.190`) y comprueba:

```bash
docker compose version     # debe mostrar la versión, sin pedir sudo
free -h                    # debe aparecer «Swap: 2.0Gi»
```

---

## 4. Descargar el código

El repositorio es privado, así que necesitas un **token de GitHub** de solo lectura:

1. GitHub → tu foto → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Resource owner:** `ACME-BEEHIVES` · **Repository access:** *Only select repositories* → `canaletica`.
3. **Permissions → Repository permissions → Contents:** *Read-only*.
4. **Generate token** y cópialo (solo se muestra una vez).

En el servidor:

```bash
sudo mkdir -p /opt/canal && sudo chown ubuntu:ubuntu /opt/canal
git clone https://github.com/ACME-BEEHIVES/canaletica.git /opt/canal
#   Username: tu usuario de GitHub
#   Password: el token (no tu contraseña)
cd /opt/canal
```

---

## 5. Configuración (`.env`)

Genera las claves secretas (cada una distinta):

```bash
for v in DB_PASSWORD JWT_SECRET MFA_ENCRYPTION_KEY SETTINGS_ENCRYPTION_KEY; do echo "$v=$(openssl rand -hex 32)"; done
```

Cópialas a un lugar seguro (gestor de contraseñas). **Si se pierden `MFA_ENCRYPTION_KEY` o
`SETTINGS_ENCRYPTION_KEY`, los usuarios deben reconfigurar su 2FA y se pierden las claves SMTP guardadas.**

Crea el archivo:

```bash
nano .env
```

Pega esto y reemplaza los valores `<…>` (la IP ya está puesta):

```env
# --- Dirección pública (HTTPS con certificado de Let's Encrypt para la IP) ---
DOMAIN=98.81.72.190
APP_URL=https://98.81.72.190
CORS_ORIGIN=https://98.81.72.190
CADDY_TLS=ip

# --- Base de datos (PostgreSQL en Docker) ---
DB_USER=canal
DB_PASSWORD=<generado>
DB_SSL=false
GLOBAL_DB_NAME=canal_global
TENANT_DB_PREFIX=tenant_

# --- API ---
PORT=4000
JWT_SECRET=<generado>
JWT_EXPIRES_IN=8h
MFA_ENCRYPTION_KEY=<generado>
SETTINGS_ENCRYPTION_KEY=<generado>
MFA_ISSUER=Canal de Denuncias (demo)
# Hay dos proxies delante del backend: Caddy y nginx
TRUST_PROXY=2

# --- Correo: en la demo lo atrapa Mailpit ---
MAIL_FROM=Canal de Denuncias <no-responder@canal-demo.local>

# --- Primer administrador de la plataforma ---
GLOBAL_ADMIN_EMAIL=tu-correo@empresa.cl
GLOBAL_ADMIN_PASSWORD=<contraseña larga temporal>
GLOBAL_ADMIN_NAME=Tu Nombre

# --- Archivos y auditoría ---
STORAGE_DRIVER=local
AUDIT_HOT_MONTHS=12
AUDIT_CASE_VIEW_WINDOW=30
```

Guarda con `Ctrl+O`, `Enter`, `Ctrl+X`, y protege el archivo:

```bash
chmod 600 .env
```

---

## 6. Levantar el canal

```bash
cd /opt/canal
docker compose -f docker-compose.prod.yml -f docker-compose.demo.yml up -d --build
```

La primera vez tarda **5 a 10 minutos** (compila el backend y el frontend). Luego:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.demo.yml ps
```

Deben aparecer **5 servicios** en estado `running`: `db`, `backend`, `frontend`, `caddy` y `mailpit`.

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.demo.yml logs backend | tail -20
```

Debe terminar con **`API escuchando en http://localhost:4000`**.

> **Atajo:** para no escribir los dos `-f` cada vez, crea un alias:
> ```bash
> echo "alias canal='docker compose -f /opt/canal/docker-compose.prod.yml -f /opt/canal/docker-compose.demo.yml --project-directory /opt/canal'" >> ~/.bashrc
> source ~/.bashrc
> ```
> Desde ahí: `canal ps`, `canal logs -f backend`, `canal restart backend`, etc.

---

## 7. Comprobar la conexión segura

1. Abre **`https://98.81.72.190/admin/login`**. Debe cargar **con candado** 🔒 y sin advertencias.
   - El primer acceso puede tardar unos segundos: Caddy está pidiendo el certificado a Let's Encrypt.
   - `http://98.81.72.190` redirige solo a `https://`.
2. Entra con `GLOBAL_ADMIN_EMAIL` / `GLOBAL_ADMIN_PASSWORD`. Te pedirá **cambiar la contraseña** y **configurar el 2FA**
   (Google o Microsoft Authenticator).
3. Ya con tu contraseña nueva, borra `GLOBAL_ADMIN_PASSWORD` del `.env` (`nano .env`): no se vuelve a usar.

> **Plan B:** si Let's Encrypt no pudiera emitir el certificado (por ejemplo, puertos cerrados), pon `CADDY_TLS=internal`
> y ejecuta `canal up -d`: Caddy usa un certificado propio. La conexión va cifrada, pero el navegador muestra
> «La conexión no es privada» la primera vez (*Configuración avanzada → Continuar*).

Si la página no carga, revisa los registros de Caddy:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.demo.yml logs caddy | tail -30
```

Causas típicas: puertos 80/443 cerrados en el Security Group (Let's Encrypt necesita entrar por ambos), o la IP del
`.env` no coincide con la IP pública del EC2.

---

## 8. Usar la demo

### Crear una empresa de demostración
1. **Consola → Empresas → Crear empresa**, con un plan (por ejemplo **Completo**).
2. Entra al panel de la empresa: `https://98.81.72.190/<slug>/login`.
3. En **Inicio** usa **«Cargar denuncias de ejemplo»**: crea casos ficticios para mostrar cada rol.
4. El portal del denunciante queda en `https://98.81.72.190/<slug>/denuncias`.

### Ver los correos de la demo (Mailpit)
Los correos (recuperación de contraseña, alertas de plazos, contraseñas temporales) no salen a internet. Para verlos,
abre un **túnel SSH** desde tu PC (deja esa ventana abierta):

```bash
ssh -i tu-llave.pem -L 8025:127.0.0.1:8025 ubuntu@98.81.72.190
```

y en tu navegador entra a **http://localhost:8025**.

### Comandos útiles (en el servidor, en `/opt/canal`)

| Para | Comando |
|---|---|
| Ver estado | `canal ps` |
| Ver registros del backend | `canal logs -f backend` (salir con `Ctrl+C`) |
| Reiniciar | `canal restart` |
| Detener todo (los datos se conservan) | `canal down` |
| Volver a levantar | `canal up -d` |
| Memoria y CPU | `docker stats` |
| Reiniciar la demo desde cero (**borra todo**) | `canal down -v && canal up -d` |

### Actualizar a la última versión del código

```bash
cd /opt/canal && git pull
canal up -d --build
```

Las migraciones de la base se aplican solas al arrancar el backend.

### Respaldo diario (recomendado aunque sea demo)

```bash
mkdir -p /opt/canal/respaldos
crontab -e
```

Agrega esta línea (respaldo a las 3:00, guarda 7 días):

```
0 3 * * * cd /opt/canal && docker compose -f docker-compose.prod.yml exec -T db pg_dumpall -U canal | gzip > respaldos/db-$(date +\%F).sql.gz && find respaldos -name 'db-*.gz' -mtime +7 -delete
```

---

## 9. Cuando tengan el dominio (cPanel)

Supongamos que el canal quedará en `canal.tuempresa.cl`.

1. **En cPanel → Zone Editor** (Editor de zona) del dominio → **+ A Record**:
   - **Name:** `canal`
   - **Address / Record:** la IP pública del EC2 (`98.81.72.190`, o la que tenga en ese momento)
   - **TTL:** 300 (o el que venga por defecto)
2. Espera a que resuelva. Desde tu PC: `nslookup canal.tuempresa.cl` → debe responder la IP del EC2.
3. En el servidor, cambia estas 4 líneas del `.env`:

   ```env
   DOMAIN=canal.tuempresa.cl
   APP_URL=https://canal.tuempresa.cl
   CORS_ORIGIN=https://canal.tuempresa.cl
   # Certificado de Let's Encrypt para el dominio
   CADDY_TLS=dominio
   ```

4. Aplica el cambio:

   ```bash
   canal up -d
   ```

   Caddy obtiene solo el certificado del dominio.

5. Los usuarios deberán volver a iniciar sesión (las sesiones son por dirección). Los datos se conservan.

> **Correo con el dominio:** para que los correos lleguen de verdad (y no a Mailpit), configura un SMTP real en
> **Consola → Correo saliente** (por ejemplo, la cuenta de correo del cPanel o Amazon SES) y quita
> `-f docker-compose.demo.yml` de los comandos. Configura además SPF y DKIM del dominio en cPanel
> (**Email Deliverability**).

---

## 10. Problemas frecuentes

| Síntoma | Qué revisar |
|---|---|
| El sitio no carga | `canal ps` (¿todo `running`?) y el Security Group (puertos 80 y 443) |
| Sin candado o error de certificado | `canal logs caddy`: puertos 80/443 abiertos, `DOMAIN` igual a la IP pública y `CADDY_TLS=ip` (o `dominio` con el dominio) |
| «La conexión no es privada» | Estás con `CADDY_TLS=internal` (plan B del paso 7); cambia a `ip` y ejecuta `canal up -d` |
| «Ruta no encontrada» o error 502 | `canal logs backend`: puede estar arrancando o faltar una variable del `.env` |
| No puedo iniciar sesión (vuelve al login) | `APP_URL` debe ser exactamente `https://98.81.72.190` (o el dominio) y entrar por esa misma dirección |
| La compilación se cae por memoria | Verifica el swap (`free -h`) y vuelve a ejecutar el `up -d --build` |
| Cambió la IP pública (Stop → Start) | Actualiza `DOMAIN`, `APP_URL` y `CORS_ORIGIN` con la IP nueva y ejecuta `canal up -d` |
| No llegan correos | En la demo, revísalos en Mailpit (túnel SSH del paso 8) |

---

## Archivos del proyecto que usa esta guía

| Archivo | Para qué |
|---|---|
| `docker-compose.prod.yml` | Servicios de producción: base, backend, frontend (nginx) y Caddy |
| `docker-compose.demo.yml` | Agrega Mailpit para los correos de la demo |
| `Caddyfile` | HTTPS con Let's Encrypt (para la IP o el dominio, según `CADDY_TLS`) y redirección a HTTPS, sin registros de acceso |
| `.env` | Configuración del servidor (**nunca se sube a GitHub**) |
