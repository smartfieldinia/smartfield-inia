"use client";

import Image from "next/image";
import { FlaskConical, GraduationCap, Handshake, TrendingUp, CheckCircle } from "lucide-react";
import { SectionHeading } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/Reveal";
import { useLightbox } from "@/components/ui/Lightbox";
import { useLang, Highlight } from "@/lib/i18n";

const PILAR_ICONS = [FlaskConical, GraduationCap, Handshake, TrendingUp];

export function Nosotros() {
  const { t } = useLang();
  const lightbox = useLightbox();

  return (
    <section id="nosotros" className="relative py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid grid-cols-1 items-start gap-14 lg:grid-cols-2">
          {/* Columna izquierda: texto + pilares */}
          <div>
            <Reveal>
              <SectionHeading
                kicker={t.nosotros.kicker}
                title={<Highlight text={t.nosotros.title} />}
                subtitle={t.nosotros.subtitle}
              />
            </Reveal>

            {/* Misión y visión */}
            <Reveal delay={0.1}>
              <div className="mt-8 space-y-4">
                <div className="glass rounded-2xl p-5">
                  <p className="text-xs font-semibold uppercase tracking-widest text-lime">
                    {t.nosotros.mision}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-mist-soft">
                    {t.nosotros.misionText}
                  </p>
                </div>
                <div className="glass rounded-2xl p-5">
                  <p className="text-xs font-semibold uppercase tracking-widest text-lime">
                    {t.nosotros.vision}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-mist-soft">
                    {t.nosotros.visionText}
                  </p>
                </div>
              </div>
            </Reveal>

            {/* Propósito */}
            <Reveal delay={0.15}>
              <div className="mt-4">
                <div className="glass rounded-2xl p-5">
                  <p className="text-xs font-semibold uppercase tracking-widest text-lime">
                    {t.nosotros.proposito}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-mist-soft">
                    {t.nosotros.propositoText}
                  </p>
                </div>
              </div>
            </Reveal>

            {/* La importancia de la colaboración */}
            <Reveal delay={0.2}>
              <div className="mt-6 glass rounded-2xl p-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-lime">
                  {t.nosotros.colaboracion}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-mist-soft">
                  {t.nosotros.colaboracionIntro}
                </p>
                <ul className="mt-4 space-y-2">
                  {t.nosotros.colaboracionItems.map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <CheckCircle size={15} className="mt-0.5 shrink-0 text-lime" />
                      <span className="text-sm leading-relaxed text-mist-soft">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>

          </div>

          {/* Columna derecha: collage de fotos + pilares */}
          <Reveal className="order-first lg:order-last">
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() =>
                  lightbox.open({ src: "/equipo.jpeg", alt: "Equipo SmartField INIA" })
                }
                className="glass group block cursor-zoom-in overflow-hidden rounded-3xl p-2"
              >
                <Image
                  src="/equipo.jpeg"
                  alt="Equipo SmartField INIA"
                  width={1200}
                  height={800}
                  className="w-full h-auto rounded-2xl transition-transform duration-500 group-hover:scale-[1.02]"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
              </button>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() =>
                    lightbox.open({ src: "/smartfield3.jpg", alt: "Centro Experimental Los Tilos" })
                  }
                  className="glass group block cursor-zoom-in overflow-hidden rounded-2xl p-2"
                >
                  <Image
                    src="/smartfield3.jpg"
                    alt="Centro Experimental Los Tilos"
                    width={800}
                    height={600}
                    className="w-full h-auto rounded-xl transition-transform duration-500 group-hover:scale-[1.02]"
                    sizes="25vw"
                  />
                </button>

                <button
                  type="button"
                  onClick={() =>
                    lightbox.open({ src: "/smartfield2.jpeg", alt: "Fruticultura de precisión" })
                  }
                  className="glass group block cursor-zoom-in overflow-hidden rounded-2xl p-2"
                >
                  <Image
                    src="/smartfield2.jpeg"
                    alt="Fruticultura de precisión"
                    width={800}
                    height={600}
                    className="w-full h-auto rounded-xl transition-transform duration-500 group-hover:scale-[1.02]"
                    sizes="25vw"
                  />
                </button>
              </div>

              {/* 4 pilares */}
              <div className="mt-1 grid grid-cols-2 gap-3">
                {t.nosotros.pilares.map((p, i) => {
                  const Icon = PILAR_ICONS[i];
                  return (
                    <div
                      key={p.title}
                      className="glass flex flex-col gap-3 rounded-2xl p-5 transition-all duration-300 hover:border-lime/35"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime/10 text-lime ring-1 ring-edge">
                        <Icon size={20} />
                      </div>
                      <h3 className="font-[family-name:var(--font-display)] text-sm font-semibold text-strong">
                        {p.title}
                      </h3>
                      <p className="text-xs leading-relaxed text-mist-soft">{p.text}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
