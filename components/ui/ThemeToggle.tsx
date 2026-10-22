"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "dark" | "light";

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current =
      (document.documentElement.getAttribute("data-theme") as Theme) || "light";
    // El tema real lo fija el script anti-parpadeo de layout.tsx sobre <html>
    // antes del primer paint; acá solo se lee ese atributo ya escrito.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(current);
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("sf-theme", next);
    } catch {
      /* noop */
    }
  };

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}
      title={theme === "dark" ? "Modo claro" : "Modo oscuro"}
      className={cn(
        "glass flex h-10 w-10 items-center justify-center rounded-xl text-mist transition-colors hover:text-lime",
        className,
      )}
    >
      {/* Evita mismatch de hidratación: render neutro hasta montar */}
      {mounted && theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
