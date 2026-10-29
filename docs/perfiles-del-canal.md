# Perfiles del Canal de Denuncias

El canal tiene **6 perfiles de usuario**, más el **denunciante**, que no necesita cuenta. Una misma persona puede tener
varios perfiles y cambiar entre ellos desde su menú de usuario; los permisos se evalúan siempre con el **perfil activo**.

| Perfil | Ámbito | ¿Ve denuncias? |
|---|---|---|
| Administrador global | Toda la plataforma (equipo BeeHives) | No |
| Administrador del canal | Su empresa | No |
| Gestor de denuncias | Sus categorías y su área | Sí, completas |
| Investigador | Las denuncias que tiene asignadas | Sí, completas |
| Comité / resolutor | Sus categorías, desde que llegan a resolución | Sí, completas |
| Auditor | Toda la empresa | Sí, sin datos que identifiquen a las personas |
| Denunciante | Su propia denuncia | Solo la suya |

---

## 1. Administrador global (`global_admin`) — equipo BeeHives

Administra **la plataforma completa** desde la consola (`/admin`). **No ve denuncias de ninguna empresa.**

- **Empresas:** crea empresas (cada una con su propia base de datos), les asigna un plan y edita su ficha comercial.
  También puede suspenderlas o reactivarlas, y crea los administradores de cada empresa.
- **Planes:** define qué leyes, módulos y límites incluye cada plan.
- **Consumo:** revisa cuántas denuncias, archivos y espacio usa cada empresa (solo cifras), y puede exportarlo a CSV.
- **Equipo BeeHives:** agrega otros administradores globales y les restablece la contraseña o el 2FA.
- **Auditoría** de toda la plataforma, **estado del sistema** y **correo saliente** por defecto (SMTP).

## 2. Administrador del canal (`client_admin`) — en cada empresa

Configura el canal de **su empresa**. **No ve denuncias.**

- **Usuarios y roles:** crea usuarios, les asigna perfiles, área y categorías, y puede desactivarlos o restablecerles la
  contraseña o el 2FA.
- **Áreas y categorías:** define qué áreas pueden hacerse cargo de cada tipo de denuncia (por ejemplo, Ley Karin solo
  Recursos Humanos).
- **Portal del denunciante:** textos, política, si admite denuncias anónimas y datos de contacto.
- **Marca** (logo y color), **correo saliente** propio y **flujos de gestión** (plazos y pasos propios, salvo Ley Karin),
  según lo que incluya el plan.
- **Reglas de gestión:**
  - **Modalidad simplificada:** una persona puede tener varios roles.
  - **Modalidad completa:** separa funciones (doble aprobación).
  - **Plan ante conflicto de interés:** suplente o contacto externo.
- Puede **cargar denuncias de ejemplo** para conocer el sistema, y revisa la **auditoría** de su empresa.

## 3. Gestor de denuncias (`case_manager`)

Es el **responsable principal** de las denuncias de **sus categorías y su área**.

- Recibe las denuncias nuevas, las **revisa, clasifica o reclasifica**, y les **asigna un investigador**.
- Registra los **hitos y plazos legales**, adopta **medidas de protección** y comunica a la autoridad (por ejemplo, la
  Dirección del Trabajo en Ley Karin).
- Conversa con el denunciante por el **buzón seguro**; el denunciante ve sus mensajes como «Equipo del canal».
- Agrega **tareas**, **extiende plazos** que no son legales (siempre con motivo) y gestiona las **personas excluidas por
  conflicto de interés**.
- **Registra denuncias recibidas por otras vías**: verbales, por carta, notificadas por la DT u otra autoridad.
- Ve la bandeja **Por asignar**, los **Plazos**, los **Mensajes**, los **Reportes** y la **campana de alertas**, además de
  las **evidencias** que adjunta el denunciante.

## 4. Investigador (`investigator`)

Investiga **solo las denuncias que le asignaron**.

- Registra **diligencias** (entrevistas, documentos, inspecciones) y **medidas**.
- Conversa con el denunciante, ve y descarga las **evidencias**, y completa los **pasos del flujo** que le corresponden.
- **Propone la conclusión** al terminar: hechos acreditados, parcialmente acreditados o no acreditados.
- Ve sus **plazos** y la **campana de alertas** de lo que le toca.

## 5. Comité o resolutor (`resolver`)

**Decide el cierre.** Ve las denuncias de sus categorías cuando llegan a resolución, están en seguimiento o ya se
cerraron.

- **Aprueba o rechaza** la conclusión propuesta por el investigador, o una desestimación.
- No puede aprobar si faltan pasos obligatorios del flujo.
- Ve las **Resueltas**, los **Reportes** y las **evidencias**.

## 6. Auditor (`auditor`)

**Revisa sin modificar nada**, y **sin ver contenido que identifique a las personas**.

- Ve todas las denuncias con sus estados, plazos, extensiones y trazabilidad. No ve el relato, los nombres ni el
  contenido de las evidencias: solo sabe que existen y cuándo llegaron.
- Revisa el **registro de accesos** (quién abrió cada denuncia y qué hizo) y los **Reportes**.

## 7. Denunciante (sin cuenta)

Entra al **portal público** de la empresa (`/<empresa>/denuncias`).

- **Hace la denuncia**, anónima o identificada. Ley Karin exige identificarse con nombre, RUT y correo.
- Recibe una **clave de seguimiento** y, si quiere, asocia una **app de autenticación**.
- Desde el seguimiento ve el estado, **conversa con el equipo** y **adjunta evidencias** cuando la denuncia ya está en
  revisión.
- No se guarda su IP ni su dispositivo.

---

## Reglas que aplican a todos

- **Conflicto de interés:** quien está involucrado en una denuncia **no la ve con ningún perfil**. Además, se excluye
  automáticamente a quien el denunciante nombra; si todos los gestores quedan excluidos, la gestiona el suplente.
- **Área y categoría:** el gestor, el investigador y el comité solo ven las denuncias de las categorías autorizadas
  para su área.
- **Auditoría:** todo acceso a una denuncia y toda acción administrativa quedan registrados.
- **Seguridad de la cuenta:** todos los perfiles con cuenta usan **verificación en dos pasos (2FA)**.
- **Plan de la empresa:** los módulos que el plan no incluye no aparecen en ningún perfil.
