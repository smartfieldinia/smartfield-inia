"use client";

import Link from "next/link";
import { GraduationCap, MonitorPlay, ArrowUpRight } from "lucide-react";
import { SectionHeading } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/Reveal";
import { useLang, Highlight } from "@/lib/i18n";

const ICONS = [GraduationCap, MonitorPlay];

export function PlataformasComplementarias() {
  const { t } = useLang();

  return (
    <section id="plataformas" className="relative py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Reveal>
          <SectionHeading
            center
            kicker={t.plataformas.kicker}
            title={<Highlight text={t.plataformas.title} />}
            subtitle={t.plataformas.subtitle}
          />
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2">
            {t.plataformas.items.map((item, i) => {
              const Icon = ICONS[i];
              const isExternal = item.href.startsWith("http");
              const cardClassName =
                "glass group relative flex flex-col overflow-hidden rounded-3xl p-8 transition-all duration-300 hover:border-lime/35 hover:-translate-y-1.5";
              const content = (
                <>
                  <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-lime/5 blur-3xl transition-opacity duration-500 opacity-0 group-hover:opacity-100" />

                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-lime/10 text-lime ring-1 ring-edge">
                    <Icon size={28} />
                  </div>

                  <h3 className="mt-6 font-[family-name:var(--font-display)] text-2xl font-semibold text-strong">
                    {item.title}
                  </h3>

                  <p className="mt-3 flex-1 text-sm leading-relaxed text-mist-soft">
                    {item.text}
                  </p>

                  <span className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-lime">
                    {item.cta}
                    <ArrowUpRight
                      size={16}
                      className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    />
                  </span>
                </>
              );

              return isExternal ? (
                <a
                  key={item.title}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cardClassName}
                >
                  {content}
                </a>
              ) : (
                <Link key={item.title} href={item.href} className={cardClassName}>
                  {content}
                </Link>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
