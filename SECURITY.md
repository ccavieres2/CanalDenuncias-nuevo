# Seguridad del Canal de Denuncias

**BeeHives · Canal de Denuncias**

Un canal de denuncias recibe información muy sensible: hechos de acoso, posibles delitos, datos personales y, sobre
todo, la identidad de quien se atreve a denunciar. Por eso la seguridad no es un complemento: es la base con la que
está construida la plataforma.

Este documento resume cómo protegemos la información de tu empresa y de las personas que usan el canal.

---

## En resumen

- **Tus datos están separados de los de cualquier otra empresa:** base de datos exclusiva y carpeta de archivos
  exclusiva para tu organización.
- **Todo viaja y se guarda cifrado**, en la infraestructura de **Amazon Web Services (AWS)**.
- **Los archivos adjuntos se analizan automáticamente** en busca de virus y software malicioso.
- **Acceso con verificación en dos pasos obligatoria** para todo tu equipo.
- **Cada persona ve solo lo que le corresponde** según su rol.
- **El denunciante puede mantenerse anónimo:** no registramos su IP ni datos de su dispositivo.
- **Todo queda registrado:** quién ingresó, qué revisó y qué cambió.

---

## 1. Tus datos, separados de los de otras empresas

Cada empresa cliente tiene su propio espacio, aislado del resto:

- **Base de datos exclusiva.** La información de tu canal (denuncias, mensajes, usuarios y configuración) se guarda
  en una base de datos propia de tu empresa, en **Amazon RDS**. No se comparte ni se mezcla con la de otros clientes.
- **Carpeta de archivos exclusiva y cifrada.** Los documentos y evidencias se guardan en **Amazon S3**, en una
  carpeta privada de tu empresa, cifrada y sin ningún acceso público.
- **Accesos independientes.** Una sesión de tu empresa solo sirve en tu canal: no permite entrar al de otra empresa
  ni a la administración de la plataforma.

## 2. Cifrado de extremo a extremo

- **En tránsito:** toda la comunicación entre el navegador y la plataforma, y entre la plataforma y la base de datos,
  viaja cifrada (HTTPS / TLS), verificando la identidad de cada servidor.
- **En reposo:** las bases de datos, sus respaldos y los archivos se guardan cifrados con AES-256, usando el servicio
  de gestión de claves de AWS (**AWS KMS**).
- **Protección adicional para lo más sensible:** las contraseñas nunca se guardan (solo una huella irreversible), y los
  secretos de verificación y las credenciales de correo se guardan con un cifrado adicional propio de la plataforma.

## 3. Archivos adjuntos analizados automáticamente

Cada archivo que se sube al canal se revisa con **Amazon GuardDuty Malware Protection for S3**, el servicio de AWS
que detecta virus y software malicioso. Los archivos se analizan apenas se suben, y un archivo peligroso queda
bloqueado y aislado antes de que alguien pueda abrirlo. Así, ni tu equipo ni la plataforma quedan expuestos a
archivos infectados.

## 4. Acceso seguro para tu equipo

- **Verificación en dos pasos obligatoria** para todas las cuentas, con una app de autenticación (Google
  Authenticator, Microsoft Authenticator u otra). Aunque alguien obtenga una contraseña, no puede ingresar sin el
  teléfono de la persona.
- **Contraseñas robustas** y protegidas: nunca se almacenan en texto legible.
- **Bloqueo ante intentos repetidos** de ingreso, para impedir que se adivinen contraseñas o códigos.
- **Sesiones protegidas** que vencen automáticamente y se cierran al instante si se desactiva a una persona, se le
  quita un rol o cambia su contraseña.
- **Recuperación de contraseña segura:** por código de un solo uso enviado al correo, con vencimiento, y sin saltarse
  nunca la verificación en dos pasos.

## 5. Cada persona ve solo lo que le corresponde

- **Roles con permisos distintos:** administrador del canal, gestor de denuncias, investigador, resolutor y auditor.
- **El administrador del canal configura la plataforma, pero no puede ver el contenido de las denuncias.**
- **Visibilidad por área y tipo de denuncia:** cada persona accede únicamente a los casos que le han sido asignados o
  que corresponden a su área.
- **Prevención de conflictos de interés:** quien participó en un caso no puede resolverlo.

## 6. Protección del denunciante

- **Anonimato real:** cuando una persona denuncia de forma anónima, la plataforma **no registra su dirección IP**,
  su navegador ni datos de su dispositivo, **no usa cookies** y no guarda nada en su equipo. Tampoco carga recursos
  de terceros (como servicios de Google o de analítica) que pudieran rastrearla.
- **Seguimiento sin revelar su identidad:** el denunciante recibe una clave personal para consultar su denuncia y
  conversar con tu equipo. Esa clave no se guarda en la plataforma, por lo que nadie más puede recuperarla.
- **Segunda opción de acceso** mediante una app de autenticación, también sin revelar su identidad.
- **Denuncias por Ley Karin:** siguiendo la normativa, se solicita identificación (nombre, RUT y correo), que se trata
  con la misma confidencialidad.

## 7. Trazabilidad completa

- **Registro de auditoría** de ingresos, intentos fallidos, cambios de configuración y administración de usuarios.
- **Registro de accesos a cada denuncia:** queda constancia de quién la abrió y cuándo, disponible para el rol
  auditor.
- **Bitácora de cada caso** con todas las acciones realizadas durante su gestión.
- Los registros históricos se conservan comprimidos y cifrados, verificados antes de archivarse.

## 8. Protección contra ataques

La plataforma incorpora las protecciones recomendadas por las buenas prácticas de seguridad web (OWASP):
protección contra inyección de código, contra suplantación de solicitudes (CSRF) y contra la inserción del sitio en
páginas de terceros, validación estricta de toda la información recibida y límites de uso para evitar abusos.

## 9. Infraestructura en AWS

- Plataforma alojada en **Amazon Web Services**, con centros de datos que cuentan con certificaciones
  internacionales de seguridad (como ISO 27001 y SOC 2).
- **Base de datos en una red privada**, sin acceso directo desde internet.
- **Respaldos automáticos y cifrados** de la información.
- Servicios internos de administración aislados, nunca expuestos públicamente.

## 10. Normativa

La plataforma está diseñada considerando:

- **Ley 21.643 (Ley Karin)** y su reglamento: procedimiento, plazos y confidencialidad de las denuncias de acoso y
  violencia en el trabajo.
- **Ley 20.393 y Ley 21.595:** modelo de prevención de delitos y delitos económicos.
- **Ley 21.719 de protección de datos personales:** confidencialidad, minimización de datos y trazabilidad.
- **ISO 37002** (sistemas de gestión de denuncias) como referencia de buenas prácticas.

---

## Contacto

¿Tienes preguntas sobre la seguridad de la plataforma o necesitas información adicional para tu evaluación de
proveedores? Escríbenos y con gusto te ayudamos.

<!-- Definir aquí el correo de contacto de seguridad de BeeHives. -->
