"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { translations, type Dict, type Lang } from "@/lib/translations";

type LangCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  t: Dict;
};

const Ctx = createContext<LangCtx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("es");

  useEffect(() => {
    let stored: Lang = "es";
    try {
      stored = (localStorage.getItem("sf-lang") as Lang) || "es";
    } catch {
      /* noop */
    }
    // El idioma vive en localStorage, que no existe durante el SSR: sincronizarlo
    // después de montar es justamente lo que evita el mismatch de hidratación.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLangState(stored);
    document.documentElement.lang = stored;
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.documentElement.lang = l;
    try {
      localStorage.setItem("sf-lang", l);
    } catch {
      /* noop */
    }
  }, []);

  const toggle = useCallback(() => {
    setLangState((prev) => {
      const next: Lang = prev === "es" ? "en" : "es";
      document.documentElement.lang = next;
      try {
        localStorage.setItem("sf-lang", next);
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  return (
    <Ctx.Provider value={{ lang, setLang, toggle, t: translations[lang] }}>
      {children}
    </Ctx.Provider>
  );
}

export function useLang(): LangCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLang debe usarse dentro de <LangProvider>");
  return ctx;
}

/**
 * Renderiza un texto resaltando el fragmento entre **...** con .text-gradient.
 * Soporta saltos de línea con \n.
 */
export function Highlight({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, li) => (
        <span key={li}>
          {li > 0 && <br />}
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
            part.startsWith("**") && part.endsWith("**") ? (
              <span key={i} className="text-gradient">
                {part.slice(2, -2)}
              </span>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </span>
      ))}
    </>
  );
}
