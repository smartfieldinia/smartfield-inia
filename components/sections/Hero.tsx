"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Satellite, Sprout, Radio } from "lucide-react";
import { NeonButton, Badge } from "@/components/ui/primitives";
import { useLang, Highlight } from "@/lib/i18n";

const STAT_ICONS = [Satellite, Sprout, Radio];

export function Hero() {
  const reduce = useReducedMotion();
  const { t } = useLang();

  return (
    <section
      id="hero"
      className="relative flex min-h-[80vh] items-center overflow-hidden pt-10 pb-16 sm:pt-14 lg:min-h-[88vh]"
    >
      {/* fondo full-bleed: campo con capa NDVI (la imagen deja libre el lado izquierdo para el texto) */}
      <div className="pointer-events-none absolute inset-0">
        <Image
          src="/banners/hero-ndvi.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[72%_center]"
        />
        {/* overlays theme-aware para legibilidad en dark y light */}
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/60 to-ink/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-transparent to-ink/25" />
        {/* en celular el texto queda encima del campo: un velo parejo lo mantiene legible */}
        <div className="absolute inset-0 bg-ink/55 lg:hidden" />
      </div>

      <div className="relative mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Badge>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-lime opacity-75 [animation:pulse-ring_2s_ease-out_infinite]" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-lime" />
              </span>
              {t.hero.badge}
            </Badge>
          </motion.div>

          <motion.h1
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.08 }}
            className="mt-6 font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.04] tracking-tight text-strong sm:text-6xl lg:text-7xl"
          >
            <Highlight text={t.hero.title} />
          </motion.h1>

          <motion.p
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.16 }}
            className="mt-6 max-w-xl text-lg leading-relaxed text-mist-soft"
          >
            {t.hero.subtitle}
          </motion.p>

          <motion.div
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.24 }}
            className="mt-9 flex flex-wrap items-center gap-4"
          >
            <NeonButton href="/avisa" variant="primary">
              {t.avisa.ctaPrimary}
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
            </NeonButton>
            <NeonButton href="/plataforma" variant="ghost">
              {t.hero.ctaTour}
            </NeonButton>
          </motion.div>

          <motion.div
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="mt-12 flex flex-wrap gap-x-10 gap-y-4"
          >
            {t.hero.stats.map((s, i) => {
              const Icon = STAT_ICONS[i];
              return (
                <div key={s.label} className="flex items-center gap-3">
                  <div className="glass flex h-10 w-10 items-center justify-center rounded-xl text-lime">
                    <Icon size={18} />
                  </div>
                  <div>
                    <div className="font-[family-name:var(--font-display)] text-lg font-bold text-strong">
                      {s.value}
                    </div>
                    <div className="text-xs text-mist-soft">{s.label}</div>
                  </div>
                </div>
              );
            })}
          </motion.div>
        </div>

        {/* chips de datos flotando sobre el campo NDVI del fondo (solo desktop) */}
        <motion.div
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9, delay: 0.35 }}
          className="relative hidden h-[420px] lg:block"
        >
          <HeroDataChips />
        </motion.div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ink to-transparent" />
    </section>
  );
}

function HeroDataChips() {
  const { t } = useLang();
  const reduce = useReducedMotion();

  const chips = [
    { label: "NDVI", value: "0.78", color: "text-lime", pos: "left-[10%] top-[16%]", delay: "0s" },
    { label: "ET0", value: "4.2 mm", color: "text-cyan", pos: "right-[4%] top-[40%]", delay: "1.3s" },
    { label: "H₂O", value: "62%", color: "text-teal-bright", pos: "left-[22%] bottom-[16%]", delay: "2.1s" },
  ];

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* badge live */}
      <div
        className={`absolute right-[10%] top-[8%] flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 ring-1 ring-black/20 backdrop-blur-md ${reduce ? "" : "animate-float"}`}
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-lime opacity-75 [animation:pulse-ring_2s_ease-out_infinite]" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-lime" />
        </span>
        <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-widest text-white/85">
          {t.hero.live}
        </span>
      </div>

      {chips.map((c) => (
        <div
          key={c.label}
          className={`absolute ${c.pos} rounded-xl bg-black/55 px-3.5 py-2 font-[family-name:var(--font-mono)] text-xs text-white/85 ring-1 ring-black/20 backdrop-blur-md ${reduce ? "" : "animate-float"}`}
          style={reduce ? undefined : { animationDelay: c.delay }}
        >
          {c.label} <span className={c.color}>{c.value}</span>
        </div>
      ))}
    </div>
  );
}
