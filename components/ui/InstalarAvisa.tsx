"use client";

import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { useLang } from "@/lib/i18n";

/**
 * Botón "Instalar Avisa en tu teléfono" de la landing /avisa (PWA, 2026-10-22).
 * Misma lógica que el de /app (public/app.html, "INSTALAR APP"): el manifest
 * abre /app a pantalla completa.
 *   - Android / Chrome: `beforeinstallprompt` → diálogo nativo de instalación.
 *   - iPhone / iPad: Safari no instala desde la página → pasos Compartir → "Agregar a inicio".
 * No aparece si ya corre instalada, ni en escritorio sin aviso del navegador.
 */
type EventoInstalar = Event & { prompt: () => void; userChoice: Promise<unknown> };

const esAppInstalada = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
const esIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPad con iPadOS
const esTactil = () => window.matchMedia?.("(pointer: coarse)").matches;

export function InstalarAvisa() {
  const { t } = useLang();
  const i = t.avisa.install;
  const [evento, setEvento] = useState<EventoInstalar | null>(null);
  const [visible, setVisible] = useState(false);
  const [pasos, setPasos] = useState<readonly string[] | null>(null);

  useEffect(() => {
    if (esAppInstalada()) return;
    // Deliberado: matchMedia solo existe después de montar (SSR no sabe si es teléfono).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(Boolean(esTactil()));
    const alAvisar = (e: Event) => {
      e.preventDefault(); // sin la mini-barra de Chrome: se instala desde el botón
      setEvento(e as EventoInstalar);
      setVisible(true);
    };
    const alInstalar = () => { setEvento(null); setVisible(false); };
    window.addEventListener("beforeinstallprompt", alAvisar);
    window.addEventListener("appinstalled", alInstalar);
    return () => {
      window.removeEventListener("beforeinstallprompt", alAvisar);
      window.removeEventListener("appinstalled", alInstalar);
    };
  }, []);

  if (!visible) return null;

  async function instalar() {
    if (evento) {
      evento.prompt();
      await evento.userChoice.catch(() => null);
      setEvento(null);
      return;
    }
    setPasos(esIOS() ? i.ios : i.android);
  }

  return (
    <>
      <button
        type="button"
        onClick={instalar}
        className="group inline-flex items-center justify-center gap-2 rounded-full border border-lime/50 px-6 py-3 text-sm font-semibold text-strong transition-all duration-300 hover:-translate-y-0.5 hover:border-lime hover:bg-lime/10"
      >
        <Smartphone size={16} />
        {i.cta}
      </button>

      {pasos && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.65)" }}
          onClick={() => setPasos(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="instalar-avisa-titulo"
            className="w-full max-w-sm rounded-2xl bg-ink p-6 border border-edge shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="instalar-avisa-titulo" className="text-lg font-semibold text-strong">{i.title}</h3>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-mist-soft">
              {pasos.map((p) => <li key={p}>{p}</li>)}
            </ol>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setPasos(null)}
                className="rounded-full bg-lime px-5 py-2 text-sm font-semibold text-onlime"
              >
                {i.ok}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
