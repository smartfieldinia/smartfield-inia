"use client";

import Image from "next/image";
import { MapPin, Wrench } from "lucide-react";
import { SectionHeading, Badge } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/Reveal";
import { useLightbox } from "@/components/ui/Lightbox";
import { useLang, Highlight } from "@/lib/i18n";

export function LosTilos() {
  const { t } = useLang();
  const lightbox = useLightbox();

  return (
    <section id="los-tilos" className="relative py-12 sm:py-16">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-4 sm:px-6 lg:grid-cols-2">
        {/* Texto */}
        <div className="order-2 lg:order-1">
          <Reveal>
            <SectionHeading
              kicker={t.losTilos.kicker}
              title={<Highlight text={t.losTilos.title} />}
              subtitle={t.losTilos.subtitle}
            />
          </Reveal>
          <Reveal delay={0.1}>
            <div className="mt-8 flex flex-wrap gap-3">
              <Badge>
                <MapPin size={14} /> {t.losTilos.badge1}
              </Badge>
              <Badge>
                <Wrench size={14} /> {t.losTilos.badge2}
              </Badge>
            </div>
          </Reveal>
        </div>

        {/* Imágenes (collage: centro real + fruticultura) */}
        <Reveal className="order-1 lg:order-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {/* Foto principal: el centro real */}
            <button
              type="button"
              onClick={() =>
                lightbox.open({ src: "/smartfield3.jpg", alt: "Centro Experimental INIA Los Tilos, Buin" })
              }
              className="glass group relative block cursor-zoom-in overflow-hidden rounded-3xl p-2 sm:col-span-3"
            >
              <div className="relative aspect-[16/10] overflow-hidden rounded-2xl">
                <Image
                  src="/smartfield3.jpg"
                  alt="Centro Experimental INIA Los Tilos, Buin"
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 ring-1 ring-black/20 backdrop-blur">
                  <span className="h-2 w-2 rounded-full bg-lime" />
                  <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-widest text-white">
                    {t.losTilos.location}
                  </span>
                </div>
              </div>
            </button>

            {/* Foto secundaria: fruticultura */}
            <button
              type="button"
              onClick={() =>
                lightbox.open({ src: "/smartfield2.jpeg", alt: "Arándanos en producción en Los Tilos" })
              }
              className="glass group relative block cursor-zoom-in overflow-hidden rounded-2xl p-2 sm:col-span-2"
            >
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl">
                <Image
                  src="/smartfield2.jpeg"
                  alt="Arándanos en producción en Los Tilos"
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  sizes="(max-width: 1024px) 66vw, 33vw"
                />
              </div>
            </button>

            {/* Chip estadístico */}
            <div className="glass flex flex-col justify-center rounded-2xl p-4 text-center">
              <span className="font-[family-name:var(--font-display)] text-2xl font-bold text-gradient">
                {t.losTilos.statValue}
              </span>
              <span className="mt-1 text-[11px] leading-tight text-mist-soft">
                {t.losTilos.statLabel}
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
