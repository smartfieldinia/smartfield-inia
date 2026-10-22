"use client";

import { usePathname } from "next/navigation";
import { LogoSFI } from "@/components/ui/LogoSFI";
import { useLang } from "@/lib/i18n";
import { anclaHome } from "@/lib/utils";

export function Footer() {
  const { t } = useLang();
  const pathname = usePathname();
  const year = new Date().getFullYear();

  return (
    <footer className="relative border-t border-edge pb-8 pt-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center">
              <LogoSFI className="h-16 w-auto" />
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-mist-soft">
              {t.footer.tagline}
            </p>
          </div>

          {t.footer.cols.map((c) => (
            <div key={c.title}>
              <h4 className="font-[family-name:var(--font-display)] text-sm font-semibold text-strong">
                {c.title}
              </h4>
              <ul className="mt-4 space-y-2.5">
                {c.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={anclaHome(l.href, pathname)}
                      className="text-sm text-mist-soft transition-colors hover:text-lime"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-edge pt-6 sm:flex-row">
          <p className="text-xs text-mist-soft">© {year} {t.footer.rights}</p>
          <p className="font-[family-name:var(--font-mono)] text-xs text-mist-soft">
            {t.footer.by}{" "}
            <a
              href="https://sadata.io"
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-4 transition-colors hover:text-lime hover:underline"
            >
              SADATA
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
