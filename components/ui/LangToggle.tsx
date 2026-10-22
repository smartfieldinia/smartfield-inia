"use client";

import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LangToggle({ className }: { className?: string }) {
  const { lang, toggle } = useLang();
  return (
    <button
      onClick={toggle}
      aria-label={lang === "es" ? "Switch to English" : "Cambiar a español"}
      title={lang === "es" ? "English" : "Español"}
      className={cn(
        "glass flex h-10 items-center justify-center rounded-xl px-2.5 font-[family-name:var(--font-mono)] text-[11px] font-semibold tracking-wide text-mist transition-colors hover:text-lime sm:px-3 sm:text-xs sm:tracking-wider",
        className,
      )}
    >
      <span className={lang === "es" ? "text-lime" : ""}>ES</span>
      <span className="mx-1 opacity-40">/</span>
      <span className={lang === "en" ? "text-lime" : ""}>EN</span>
    </button>
  );
}
