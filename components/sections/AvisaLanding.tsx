"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen, CloudSun, Satellite, UserPlus, MapPinned, BellRing, MessageCircle } from "lucide-react";
import { NeonButton, SectionHeading } from "@/components/ui/primitives";
import { Reveal, Stagger, itemVariants } from "@/components/ui/Reveal";
import { LogoAvisa, AVISA_WA_URL } from "@/components/ui/LogoAvisa";
import { InstalarAvisa } from "@/components/ui/InstalarAvisa";
import { WhatsAppMock, type MockMsg } from "@/components/ui/WhatsAppMock";
import { useLang, Highlight } from "@/lib/i18n";

const STEP_ICONS = [UserPlus, MapPinned, BellRing];
const SOURCE_ICONS = [BookOpen, CloudSun, Satellite];

/** Landing propia de Avisa (/avisa; /asistente redirige acá). */
export function AvisaLanding() {
  const { t } = useLang();
  const a = t.avisa;

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden pt-10 pb-12 sm:pt-16 sm:pb-16">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Reveal>
            <LogoAvisa className="h-28 w-auto sm:h-40" priority />
            <h1 className="mt-6 font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.06] tracking-tight text-strong sm:text-6xl">
              <Highlight text={a.pageTitle} />
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-mist-soft">{a.pageSubtitle}</p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <NeonButton href="/registro" variant="primary">
                {a.ctaRegister}
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </NeonButton>
              <NeonButton href="/login" variant="ghost">
                {a.ctaLogin}
              </NeonButton>
              <InstalarAvisa />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <a
                href={AVISA_WA_URL}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-2 font-medium text-[#128c7e] transition-colors hover:text-[#075e54] [[data-theme=dark]_&]:text-[#25d366]"
              >
                <MessageCircle size={16} />
                {a.ctaWhatsapp}
              </a>
              <a
                href="/app?demo=1"
                className="text-mist-soft underline decoration-dotted underline-offset-4 transition-colors hover:text-strong"
              >
                {a.ctaDemo}
              </a>
            </div>
          </Reveal>

          <Reveal delay={0.15} className="relative">
            <div className="pointer-events-none absolute inset-x-0 -bottom-10 top-10 -z-10 overflow-hidden rounded-[2.5rem]">
              <Image src="/banners/valle.jpg" alt="" fill className="object-cover opacity-40" sizes="(max-width: 1024px) 100vw, 560px" />
              <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-ink" />
            </div>
            <WhatsAppMock messages={a.chat as MockMsg[]} status={a.chatStatus} />
          </Reveal>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="relative py-12 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <SectionHeading center kicker={a.stepsKicker} title={<Highlight text={a.stepsTitle} />} />
          </Reveal>
          <Stagger className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
            {a.steps.map((s, i) => {
              const Icon = STEP_ICONS[i];
              return (
                <motion.div key={s.title} variants={itemVariants}>
                  <div className="glass relative h-full rounded-2xl p-7">
                    <span className="absolute right-6 top-5 font-[family-name:var(--font-display)] text-5xl font-bold text-avisa-green/25">
                      {i + 1}
                    </span>
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-avisa-green/15 text-avisa ring-1 ring-edge [[data-theme=dark]_&]:text-lime">
                      <Icon size={22} />
                    </div>
                    <h3 className="mt-5 font-[family-name:var(--font-display)] text-lg font-semibold text-strong">{s.title}</h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-mist-soft">{s.text}</p>
                  </div>
                </motion.div>
              );
            })}
          </Stagger>
        </div>
      </section>

      {/* Fuentes */}
      <section className="relative py-12 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <SectionHeading center kicker={a.sourcesKicker} title={<Highlight text={a.sourcesTitle} />} />
          </Reveal>
          <Stagger className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
            {a.sources.map((s, i) => {
              const Icon = SOURCE_ICONS[i];
              return (
                <motion.div key={s.title} variants={itemVariants}>
                  <div className="h-full rounded-2xl border border-edge p-7">
                    <Icon size={26} className="text-avisa [[data-theme=dark]_&]:text-lime" />
                    <h3 className="mt-4 font-[family-name:var(--font-display)] text-lg font-semibold text-strong">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-mist-soft">{s.text}</p>
                  </div>
                </motion.div>
              );
            })}
          </Stagger>
        </div>
      </section>

      {/* Cierre */}
      <section className="relative pb-12 pt-4 sm:pb-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <Reveal>
            <div className="glass glow-lime rounded-3xl px-8 py-14 text-center sm:px-14">
              <LogoAvisa icon className="mx-auto h-16 w-16" />
              <h2 className="mt-6 font-[family-name:var(--font-display)] text-3xl font-bold leading-tight text-strong sm:text-4xl">
                <Highlight text={a.finalTitle} />
              </h2>
              <p className="mx-auto mt-4 max-w-md text-base text-mist-soft">{a.finalSubtitle}</p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <NeonButton href="/registro" variant="primary">
                  {a.ctaRegister}
                </NeonButton>
                <NeonButton href="/login" variant="ghost">
                  {a.ctaLogin}
                </NeonButton>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
