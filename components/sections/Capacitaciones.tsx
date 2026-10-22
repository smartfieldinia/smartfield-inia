"use client";

import { motion } from "framer-motion";
import { BookOpen, Video, ArrowUpRight } from "lucide-react";
import { SectionHeading } from "@/components/ui/primitives";
import { Reveal, itemVariants } from "@/components/ui/Reveal";
import { Carousel } from "@/components/ui/Carousel";
import { useLang, Highlight } from "@/lib/i18n";

const ICONS = [Video, BookOpen];

export function Capacitaciones() {
  const { t } = useLang();

  return (
    <section id="capacitaciones" className="relative py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Reveal>
          <SectionHeading
            center
            kicker={t.capacitaciones.kicker}
            title={<Highlight text={t.capacitaciones.title} />}
            subtitle={t.capacitaciones.subtitle}
          />
        </Reveal>

        <Carousel className="mt-16" gridClassName="grid-cols-2">
          {t.capacitaciones.cards.map((c, i) => {
            const Icon = ICONS[i];
            const inner = (
              <article className="glass group relative flex h-full flex-col overflow-hidden rounded-2xl p-8 transition-all duration-300 hover:border-lime/35 hover:-translate-y-1.5">
                <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-cyan/10 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-lime/10 text-lime ring-1 ring-edge">
                  <Icon size={24} />
                </div>
                <h3 className="mt-6 font-[family-name:var(--font-display)] text-xl font-semibold text-strong">
                  {c.title}
                </h3>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-mist-soft">
                  {c.text}
                </p>
                <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-lime">
                  {c.cta}
                  <ArrowUpRight
                    size={16}
                    className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  />
                </span>
              </article>
            );

            return (
              <motion.div key={c.title} variants={itemVariants}>
                {c.href ? (
                  <a href={c.href} target="_blank" rel="noopener noreferrer" className="block h-full">
                    {inner}
                  </a>
                ) : (
                  inner
                )}
              </motion.div>
            );
          })}
        </Carousel>
      </div>
    </section>
  );
}
