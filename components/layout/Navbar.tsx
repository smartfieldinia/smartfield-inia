"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { anclaHome, cn } from "@/lib/utils";
import { NeonButton } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { LangToggle } from "@/components/ui/LangToggle";
import { LogoSFI } from "@/components/ui/LogoSFI";
import { LogoAvisa } from "@/components/ui/LogoAvisa";
import { useLang } from "@/lib/i18n";

export function Navbar() {
  const { t } = useLang();
  const pathname = usePathname();
  const LINKS = t.nav.links;
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-all duration-300",
        scrolled ? "py-2" : "py-4",
      )}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <nav
          className={cn(
            "relative flex items-center justify-between rounded-2xl px-3 py-2.5 transition-all duration-300 sm:px-4 sm:py-3",
            scrolled ? "glass glow-lime" : "border border-transparent",
          )}
        >
          <Link href={anclaHome("#hero", pathname)} className="flex items-center">
            {/* Logo unificado (antes eran dos: INIA + wordmark SmartField).
                Necesita más altura que aquel par porque apila tres líneas
                —isotipo, bajada institucional y wordmark— en un bloque de
                1.69:1; con menos de h-16 la bajada deja de leerse. */}
            <LogoSFI className="h-11 w-auto sm:h-16" priority />
          </Link>

          <ul className="hidden items-center gap-7 lg:flex">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={anclaHome(l.href, pathname)}
                  className="text-sm font-medium text-mist-soft transition-colors hover:text-lime"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="hidden items-center gap-3 lg:flex">
            <LangToggle />
            <ThemeToggle />
            <NeonButton href="/avisa" variant="primary" className="py-2 pl-2 pr-5">
              <LogoAvisa icon className="h-7 w-7 bg-white" />
              Avisa
            </NeonButton>
          </div>

          <button
            onClick={() => setOpen((v) => !v)}
            className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-mist lg:hidden"
            aria-label={t.nav.menu}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </nav>

        {open && (
          <div className="glass mt-2 rounded-2xl p-4 lg:hidden">
            <ul className="flex flex-col gap-1">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <a
                    href={anclaHome(l.href, pathname)}
                    onClick={() => setOpen(false)}
                    className="block rounded-lg px-3 py-2.5 text-sm font-medium text-mist transition-colors hover:bg-lime/10 hover:text-lime"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-edge pt-3">
              <span className="text-sm font-medium text-mist-soft">
                Idioma / Tema
              </span>
              <div className="flex items-center gap-2">
                <LangToggle />
                <ThemeToggle />
              </div>
            </div>
            <NeonButton href="/avisa" variant="primary" className="mt-2 w-full">
              <LogoAvisa icon className="h-7 w-7 bg-white" />
              Avisa
            </NeonButton>
          </div>
        )}
      </div>
    </header>
  );
}
