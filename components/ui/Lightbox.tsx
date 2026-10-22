"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

type LightboxItem = { src: string; alt: string };
type LightboxCtx = { open: (item: LightboxItem) => void };

const Ctx = createContext<LightboxCtx | null>(null);

export function LightboxProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<LightboxItem | null>(null);

  const open = useCallback((it: LightboxItem) => setItem(it), []);
  const close = useCallback(() => setItem(null), []);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [item, close]);

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <AnimatePresence>
        {item && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          >
            <button
              onClick={close}
              aria-label="Cerrar"
              className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white transition-colors hover:text-lime"
            >
              <X size={20} />
            </button>
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-h-[88vh] w-auto max-w-5xl overflow-hidden rounded-2xl ring-1 ring-white/10"
            >
              <Image
                src={item.src}
                alt={item.alt}
                width={1717}
                height={1100}
                className="h-auto max-h-[88vh] w-auto object-contain"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
                <span className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-widest text-white/80">
                  {item.alt}
                </span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}

export function useLightbox() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLightbox debe usarse dentro de <LightboxProvider>");
  return ctx;
}
