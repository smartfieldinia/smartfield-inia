"use client";

import Image from "next/image";
import { Headset, Building2, BookOpen } from "lucide-react";
import { SectionHeading, NeonButton } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/Reveal";
import { useLightbox } from "@/components/ui/Lightbox";
import { useLang, Highlight } from "@/lib/i18n";

const ICONS = [Building2, Headset];

export function Asesor() {
  const { t } = useLang();
  const lightbox = useLightbox();

  return (
    <section id="asesor" className="relative py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-2">
          <div>
            <Reveal>
              <SectionHeading
                kicker={t.asesor.kicker}
                title={<Highlight text={t.asesor.title} />}
                subtitle={t.asesor.subtitle}
              />
            </Reveal>
            <Reveal delay={0.12}>
              <div className="mt-8 flex flex-wrap gap-4">
                <NeonButton href="/avisa" variant="primary">
                  <BookOpen size={16} />
                  {t.asesor.contact}
                </NeonButton>
                <NeonButton href="#marketplace" variant="ghost">
                  {t.asesor.explore}
                </NeonButton>
              </div>
            </Reveal>

            <Reveal delay={0.2}>
              <button
                type="button"
                onClick={() =>
                  lightbox.open({ src: "/equipo.jpeg", alt: t.asesor.teamCaption })
                }
                className="glass group relative mt-10 block w-full cursor-zoom-in overflow-hidden rounded-3xl p-2"
              >
                <div className="relative aspect-[8/7] overflow-hidden rounded-2xl">
                  <Image
                    src="/equipo.jpeg"
                    alt={t.asesor.teamCaption}
                    fill
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                    sizes="(max-width: 1024px) 100vw, 50vw"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4 text-left">
                    <p className="font-[family-name:var(--font-display)] text-base font-semibold text-white">
                      {t.asesor.teamCaption}
                    </p>
                  </div>
                </div>
              </button>
            </Reveal>
          </div>

          <div className="space-y-4">
            {t.asesor.channels.map((c, i) => {
              const Icon = ICONS[i];
              return (
                <Reveal key={c.title} delay={0.08 * i}>
                  <div className="glass group flex items-start gap-4 rounded-2xl p-6 transition-all duration-300 hover:border-lime/35">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-lime/10 text-lime ring-1 ring-edge">
                      <Icon size={22} />
                    </div>
                    <div>
                      <h3 className="font-[family-name:var(--font-display)] text-base font-semibold text-strong">
                        {c.title}
                      </h3>
                      <p className="mt-1 text-sm leading-relaxed text-mist-soft">
                        {c.text}
                      </p>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
