"use client";

import Image from "next/image";
import { Check } from "lucide-react";
import { SectionHeading } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/Reveal";
import { useLightbox } from "@/components/ui/Lightbox";
import { useLang, Highlight } from "@/lib/i18n";

export function Satelital() {
  const { t } = useLang();
  const lightbox = useLightbox();
  const imgAlt = t.satelital.caption;

  return (
    <section id="satelital" className="relative py-12 sm:py-16">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-4 sm:px-6 lg:grid-cols-2">
        {/* Visual */}
        <Reveal>
          <div className="glass glow-lime relative overflow-hidden rounded-3xl p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-lime" />
                <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-widest text-mist-soft">
                  {t.satelital.caption}
                </span>
              </div>
              <span className="font-[family-name:var(--font-mono)] text-[11px] text-mist-soft">
                10 m/px
              </span>
            </div>

            <button
              type="button"
              onClick={() => lightbox.open({ src: "/banners/satelital.jpg", alt: imgAlt })}
              className="group relative block w-full cursor-zoom-in overflow-hidden rounded-xl"
            >
              <Image
                src="/banners/satelital.jpg"
                alt={imgAlt}
                width={1672}
                height={941}
                className="h-auto w-full transition-transform duration-500 group-hover:scale-[1.03]"
                sizes="(max-width: 1024px) 100vw, 560px"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/40 via-transparent to-transparent" />
            </button>

            {/* leyenda rampa */}
            <div className="mt-5 flex items-center gap-3">
              <span className="font-[family-name:var(--font-mono)] text-[10px] text-mist-soft">
                {t.satelital.low}
              </span>
              <div className="h-2 flex-1 rounded-full bg-gradient-to-r from-[#3a1f10] via-[#d4c23a] to-[#176d2e]" />
              <span className="font-[family-name:var(--font-mono)] text-[10px] text-mist-soft">
                {t.satelital.high}
              </span>
            </div>
          </div>
        </Reveal>

        {/* Texto */}
        <div>
          <Reveal>
            <SectionHeading
              kicker={t.satelital.kicker}
              title={<Highlight text={t.satelital.title} />}
              subtitle={t.satelital.subtitle}
            />
          </Reveal>

          <ul className="mt-8 space-y-3">
            {t.satelital.features.map((f, i) => (
              <Reveal key={f} delay={0.06 * i}>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-lime/15 text-lime ring-1 ring-edge">
                    <Check size={13} />
                  </span>
                  <span className="text-sm leading-relaxed text-mist">{f}</span>
                </li>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
