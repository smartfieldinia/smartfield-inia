"use client";

import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { NeonButton } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/Reveal";
import { useLang, Highlight } from "@/lib/i18n";

export function CTA() {
  const { t } = useLang();
  return (
    <section id="cta" className="relative py-12 sm:py-16">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <Reveal>
          <div className="glass glow-lime relative overflow-hidden rounded-3xl px-8 py-16 text-center sm:px-16">
            {/* fondo: valle agrícola con cordillera; overlay theme-aware para legibilidad */}
            <Image
              src="/banners/valle.jpg"
              alt=""
              fill
              className="pointer-events-none object-cover"
              sizes="(max-width: 1024px) 100vw, 1024px"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink/85 via-ink/70 to-ink/85" />
            <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-lime/15 blur-[100px]" />
            <div className="pointer-events-none absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-teal/20 blur-[100px]" />

            <div className="relative">
              <span className="kicker">{t.cta.kicker}</span>
              <h2 className="mx-auto mt-5 max-w-2xl font-[family-name:var(--font-display)] text-3xl font-bold leading-tight text-strong sm:text-5xl">
                <Highlight text={t.cta.title} />
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-mist-soft">
                {t.cta.subtitle}
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-4">
                <NeonButton href="/registro" variant="primary">
                  {t.avisa.ctaRegister}
                  <ArrowRight
                    size={16}
                    className="transition-transform group-hover:translate-x-1"
                  />
                </NeonButton>
                <NeonButton href="/avisa" variant="ghost">
                  {t.avisa.ctaPrimary}
                  <ArrowRight
                    size={16}
                    className="transition-transform group-hover:translate-x-1"
                  />
                </NeonButton>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
