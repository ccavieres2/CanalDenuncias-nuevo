import { useState } from "react";
import { Link } from "react-router";
import { Icon } from "../../components/ui";
import { usePortal } from "../../lib/portal";

type IconName = Parameters<typeof Icon>[0]["name"];

/** Portada del canal: qué es, garantías y las dos acciones del denunciante. */
export function PortalHomePage() {
  const { basePath, data } = usePortal();
  const [showPolicy, setShowPolicy] = useState(false);

  const guarantees: { icon: IconName; title: string; text: string }[] = [
    {
      icon: "lock",
      title: "Confidencial",
      text: "Solo las personas designadas para gestionar el canal pueden leer tu denuncia.",
    },
    data.portal.allowAnonymous
      ? { icon: "user", title: "Puedes ser anónimo", text: "No necesitas identificarte. Igual podrás conversar con el equipo usando tu clave." }
      : { icon: "user", title: "Identidad protegida", text: "Tu identidad solo la conocen quienes gestionan el caso." },
    {
      icon: "shield",
      title: "Sin represalias",
      text: "Nadie puede sufrir consecuencias negativas por denunciar de buena fe.",
    },
  ];

  return (
    <div className="space-y-10">
      <section className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">{data.portal.title}</h1>
        <p className="mt-4 text-base leading-relaxed text-gray-600 sm:text-lg">{data.portal.welcome}</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Link
          to={`${basePath}/nueva`}
          className="group flex flex-col rounded-2xl bg-accent p-6 text-white shadow-card transition hover:bg-accent-hover sm:p-8"
        >
          <span className="flex size-12 items-center justify-center rounded-xl bg-white/10">
            <Icon name="pencil" className="size-5" />
          </span>
          <span className="mt-5 text-xl font-semibold">Hacer una denuncia</span>
          <span className="mt-1.5 text-sm leading-relaxed text-white/75">
            Cuéntanos qué pasó. Toma unos 10 minutos y al final recibirás una clave para seguir tu caso.
          </span>
          <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold">
            Comenzar
            <Icon name="chevron" className="size-3.5 transition group-hover:translate-x-0.5" />
          </span>
        </Link>
        <Link
          to={`${basePath}/seguimiento`}
          className="group flex flex-col rounded-2xl border border-line bg-white p-6 shadow-card transition hover:border-highlight/40 sm:p-8"
        >
          <span className="flex size-12 items-center justify-center rounded-xl bg-accent-soft text-highlight-text">
            <Icon name="search" className="size-5" />
          </span>
          <span className="mt-5 text-xl font-semibold text-gray-900">Seguir mi denuncia</span>
          <span className="mt-1.5 text-sm leading-relaxed text-gray-500">
            Ingresa con tu clave de seguimiento o con tu app de autenticación para ver el estado y conversar con el equipo.
          </span>
          <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-highlight-text">
            Ingresar clave
            <Icon name="chevron" className="size-3.5 transition group-hover:translate-x-0.5" />
          </span>
        </Link>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        {guarantees.map((g) => (
          <div key={g.title} className="flex gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white text-highlight-text shadow-card ring-1 ring-line">
              <Icon name={g.icon} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-gray-900">{g.title}</span>
              <span className="mt-0.5 block text-sm leading-relaxed text-gray-500">{g.text}</span>
            </span>
          </div>
        ))}
      </section>

      {data.portal.allowAnonymous && (
        <details className="group rounded-2xl border border-line bg-white shadow-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 sm:px-8">
            <span className="flex items-center gap-3 text-sm font-semibold text-gray-900">
              <Icon name="eyeOff" className="size-4 text-highlight-text" />
              Cómo cuidar tu anonimato
            </span>
            <Icon name="chevron" className="size-3.5 rotate-90 text-gray-400 transition group-open:-rotate-90" />
          </summary>
          <div className="grid gap-6 border-t border-line-soft px-5 py-5 text-sm leading-relaxed sm:grid-cols-2 sm:px-8">
            <div>
              <p className="font-semibold text-gray-900">Lo que este canal no registra</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600">
                <li>Tu dirección IP, tu navegador ni tu dispositivo.</li>
                <li>Cookies ni datos guardados en tu navegador.</li>
                <li>Conexiones a servicios de terceros (Google u otros).</li>
                <li>Tu clave de seguimiento: solo guardamos una huella irreversible.</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-gray-900">Lo que depende de ti</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600">
                <li>
                  Usa un dispositivo y una red personales: el computador y el Wi-Fi de la empresa pueden registrar los sitios que
                  visitas.
                </li>
                <li>No incluyas en el relato datos que solo tú conoces si no quieres que te reconozcan.</li>
                <li>Guarda tu clave en un lugar privado y usa una ventana de navegación privada.</li>
              </ul>
            </div>
          </div>
        </details>
      )}

      <section className="rounded-2xl border border-line bg-white px-5 py-6 shadow-card sm:px-8">
        <h2 className="text-base font-semibold text-gray-900">Otras formas de denunciar</h2>
        <p className="mt-1 text-sm text-gray-500">Todas llegan al mismo equipo y se tratan con la misma reserva.</p>
        <ul className="mt-5 grid gap-5 sm:grid-cols-2">
          {data.portal.inPerson && (
            <li className="flex gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-highlight-text">
                <Icon name="users" />
              </span>
              <span className="min-w-0 text-sm">
                <span className="block font-medium text-gray-900">En persona</span>
                <span className="block text-gray-600">{data.portal.inPerson}</span>
                <span className="block text-xs text-gray-500">Si es verbal, se deja por escrito en un acta que firmas.</span>
              </span>
            </li>
          )}
          {data.portal.phone && (
            <li className="flex gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-highlight-text">
                <Icon name="phone" />
              </span>
              <span className="min-w-0 text-sm">
                <span className="block font-medium text-gray-900">Por teléfono</span>
                <span className="block text-gray-600">{data.portal.phone}</span>
              </span>
            </li>
          )}
          {data.portal.reportEmail && (
            <li className="flex gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-highlight-text">
                <Icon name="mail" />
              </span>
              <span className="min-w-0 text-sm">
                <span className="block font-medium text-gray-900">Por correo</span>
                <span className="block break-all text-gray-600">{data.portal.reportEmail}</span>
              </span>
            </li>
          )}
          {data.categories.some((c) => c.framework === "ley_karin") && (
            <li className="flex gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-highlight-text">
                <Icon name="building" />
              </span>
              <span className="min-w-0 text-sm">
                <span className="block font-medium text-gray-900">Ante la Dirección del Trabajo</span>
                <span className="block text-gray-600">
                  Acoso laboral, acoso sexual o violencia en el trabajo (Ley Karin), en{" "}
                  <a href="https://www.dt.gob.cl" target="_blank" rel="noreferrer" className="font-medium text-highlight-text underline">
                    dt.gob.cl
                  </a>{" "}
                  o en la Inspección del Trabajo.
                </span>
              </span>
            </li>
          )}
        </ul>
      </section>

      {data.portal.policy.trim() && (
        <section className="rounded-2xl border border-line bg-white shadow-card">
          <button
            onClick={() => setShowPolicy((v) => !v)}
            className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6"
            aria-expanded={showPolicy}
          >
            <span className="flex items-center gap-3 text-sm font-semibold text-gray-900">
              <Icon name="book" className="size-4 text-highlight-text" />
              Política del canal de denuncias
            </span>
            <Icon name="chevron" className={`size-3.5 text-gray-400 transition ${showPolicy ? "-rotate-90" : "rotate-90"}`} />
          </button>
          {showPolicy && (
            <div className="border-t border-line-soft px-5 py-5 text-sm leading-relaxed whitespace-pre-line text-gray-700 sm:px-6">
              {data.portal.policy}
            </div>
          )}
        </section>
      )}

      <p className="text-sm text-gray-500">
        Si estás en peligro o presenciaste un delito en curso, contacta de inmediato a Carabineros (133) o a la PDI (134).
        {data.portal.contactEmail && (
          <>
            {" "}
            Consultas sobre el canal: <span className="font-medium text-gray-700">{data.portal.contactEmail}</span>.
          </>
        )}
      </p>
    </div>
  );
}
