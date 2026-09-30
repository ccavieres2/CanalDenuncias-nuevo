import type { Icon } from "../components/ui";
import type { CaseAction } from "./cases";

type IconName = Parameters<typeof Icon>[0]["name"];

/** Cómo se muestra cada acción del flujo. */
export const ACTION_UI: Record<CaseAction, { label: string; icon: IconName; title: string; description: string; submit: string }> = {
  start_review: {
    label: "Iniciar revisión",
    icon: "check",
    title: "Iniciar la revisión",
    description: "La denuncia pasa a «En revisión» y el denunciante recibe automáticamente el acuse de recibo.",
    submit: "Iniciar revisión",
  },
  assign: {
    label: "Asignar investigador",
    icon: "userPlus",
    title: "Asignar investigador",
    description: "Solo aparecen personas con rol de investigador, autorizadas para esta categoría y no involucradas en el caso.",
    submit: "Asignar",
  },
  reclassify: {
    label: "Reclasificar",
    icon: "pencil",
    title: "Reclasificar la denuncia",
    description: "Cambia la categoría si el denunciante eligió una que no corresponde. Los plazos se recalculan según el nuevo marco legal.",
    submit: "Reclasificar",
  },
  measure: {
    label: "Medida de resguardo",
    icon: "shield",
    title: "Registrar medida de resguardo",
    description: "Medidas para proteger a la persona denunciante mientras dura el caso (separación de espacios, cambio de turno, etc.).",
    submit: "Registrar medida",
  },
  authority: {
    label: "Aviso a la autoridad",
    icon: "building",
    title: "Registrar aviso a la autoridad",
    description: "Deja constancia de que el caso se informó a la autoridad competente. En Ley Karin es obligatorio dentro de 3 días hábiles.",
    submit: "Registrar aviso",
  },
  diligence: {
    label: "Registrar diligencia",
    icon: "search",
    title: "Registrar diligencia",
    description: "Entrevistas, revisión de documentos o verificaciones realizadas durante la investigación.",
    submit: "Registrar",
  },
  note: {
    label: "Nota interna",
    icon: "pencil",
    title: "Agregar nota interna",
    description: "Visible solo para el equipo que gestiona el caso. El denunciante no la ve.",
    submit: "Agregar nota",
  },
  propose: {
    label: "Proponer conclusión",
    icon: "check",
    title: "Proponer la conclusión",
    description: "Tu informe pasa al comité, que aprueba el cierre o lo devuelve con observaciones.",
    submit: "Enviar al comité",
  },
  dismiss: {
    label: "Proponer desestimar",
    icon: "archive",
    title: "Proponer desestimar la denuncia",
    description: "Para denuncias sin fundamento o fuera del alcance del canal. El comité debe aprobar la desestimación.",
    submit: "Enviar al comité",
  },
  approve: {
    label: "Aprobar cierre",
    icon: "check",
    title: "Aprobar el cierre",
    description: "La denuncia queda cerrada con la resolución que indiques.",
    submit: "Aprobar y cerrar",
  },
  reject: {
    label: "Devolver con observaciones",
    icon: "arrowLeft",
    title: "Devolver con observaciones",
    description: "El caso vuelve al investigador (o al gestor si era una desestimación) para que complete lo que falta.",
    submit: "Devolver",
  },
  involve: {
    label: "Conflicto de interés",
    icon: "users",
    title: "Conflicto de interés",
    description: "Marca a los usuarios del canal involucrados en los hechos. Dejarán de ver el caso con cualquier rol.",
    submit: "Guardar",
  },
  set_route: {
    label: "Definir procedimiento (Ley Karin)",
    icon: "building",
    title: "Definir el procedimiento Ley Karin",
    description:
      "Dentro de 3 días hábiles desde la recepción, la empresa decide si investiga internamente o deriva la denuncia a la Dirección del Trabajo (art. 211-C).",
    submit: "Guardar procedimiento",
  },
  milestone: {
    label: "Registrar hito",
    icon: "check",
    title: "Registrar hito",
    description: "Deja constancia de un paso del procedimiento y de la fecha en que se cumplió.",
    submit: "Registrar",
  },
  add_task: {
    label: "Agregar tarea",
    icon: "plus",
    title: "Agregar una tarea a este caso",
    description:
      "Pasos adicionales que este caso necesita (por ejemplo, pedir un informe a TI). No cambian el flujo de la empresa ni los plazos legales.",
    submit: "Agregar tarea",
  },
  extend_deadline: {
    label: "Extender plazo",
    icon: "clock",
    title: "Extender un plazo",
    description:
      "Solo plazos internos o de referencia. Los plazos legales no se pueden extender. El motivo queda registrado y lo ve el auditor.",
    submit: "Extender plazo",
  },
  message: {
    label: "Escribir al denunciante",
    icon: "mail",
    title: "Escribir al denunciante",
    description: "",
    submit: "Enviar",
  },
};

