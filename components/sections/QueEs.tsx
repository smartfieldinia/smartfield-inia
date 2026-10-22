"use client";

import Image from "next/image";
import { FlaskConical, Users, Store } from "lucide-react";
import { SectionHeading } from "@/components/ui/primitives";
import { Reveal, Stagger, itemVariants } from "@/components/ui/Reveal";
import { motion } from "framer-motion";
import { useLightbox } from "@/components/ui/Lightbox";
import { useLang, Highlight } from "@/lib/i18n";

const ICONS = [FlaskConical, Users, Store];

export function QueEs() {
  const { t } = useLang();
  const lightbox = useLightbox();
  const imgAlt = t.queEs.pillars[2].title;

  return (
    <section id="que-es" className="relative py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Reveal>
          <SectionHeading
            center
            kicker={t.queEs.kicker}
            title={<Highlight text={t.queEs.title} />}
            subtitle={t.queEs.subtitle}
          />
        </Reveal>

        <Reveal delay={0.1}>
          <button
            type="button"
            onClick={() => lightbox.open({ src: "/banners/clima.jpg", alt: imgAlt })}
            className="glass group relative mx-auto mt-12 block w-full max-w-4xl cursor-zoom-in overflow-hidden rounded-3xl p-2.5"
          >
            <div className="relative aspect-[16/9] overflow-hidden rounded-2xl sm:aspect-[21/9]">
              <Image
                src="/banners/clima.jpg"
                alt={imgAlt}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-105"
                sizes="(max-width: 896px) 100vw, 896px"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/50 via-transparent to-transparent" />
            </div>
          </button>
        </Reveal>

        <Stagger className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {t.queEs.pillars.map((p, i) => {
            const Icon = ICONS[i];
            return (
              <motion.div key={p.title} variants={itemVariants}>
                <div className="glass group relative h-full overflow-hidden rounded-2xl p-8 transition-all duration-300 hover:border-lime/35 hover:-translate-y-1">
                  <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-lime/10 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-lime/10 text-lime ring-1 ring-edge">
                    <Icon size={24} />
                  </div>
                  <h3 className="mt-6 font-[family-name:var(--font-display)] text-xl font-semibold text-strong">
                    {p.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-mist-soft">
                    {p.text}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </Stagger>
      </div>
    </section>
  );
}
