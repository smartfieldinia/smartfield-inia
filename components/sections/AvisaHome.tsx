"use client";

import { ArrowRight, BellRing, Satellite, MessageCircle } from "lucide-react";
import { motion } from "framer-motion";
import { NeonButton } from "@/components/ui/primitives";
import { Reveal, Stagger, itemVariants } from "@/components/ui/Reveal";
import { LogoAvisa } from "@/components/ui/LogoAvisa";
import { WhatsAppMock, type MockMsg } from "@/components/ui/WhatsAppMock";
import { useLang, Highlight } from "@/lib/i18n";

const ICONS = [BellRing, Satellite, MessageCircle];

/** Bloque de Avisa en el home de Smartfield: presenta el asistente y lleva a /avisa. */
export function AvisaHome() {
  const { t } = useLang();
  const a = t.avisa;

  return (
    <section id="avisa" className="relative py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="glass relative overflow-hidden rounded-[2rem] px-6 py-12 sm:px-12 sm:py-16">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-avisa-green/15 blur-[90px]" />
          <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-avisa-sky/20 blur-[90px]" />

          <div className="relative grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <Reveal>
                <LogoAvisa className="h-24 w-auto sm:h-32" />
                <h2 className="mt-6 font-[family-name:var(--font-display)] text-3xl font-bold leading-[1.1] tracking-tight text-strong sm:text-5xl">
                  <Highlight text={a.homeTitle} />
                </h2>
                <p className="mt-5 max-w-xl text-base leading-relaxed text-mist-soft sm:text-lg">
                  {a.homeSubtitle}
                </p>
              </Reveal>

              <Stagger className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {a.bullets.map((b, i) => {
                  const Icon = ICONS[i];
                  return (
                    <motion.div key={b.title} variants={itemVariants}>
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-avisa-green/15 text-avisa ring-1 ring-edge [[data-theme=dark]_&]:text-lime">
                        <Icon size={18} />
                      </div>
                      <h3 className="mt-3 text-sm font-semibold text-strong">{b.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-mist-soft">{b.text}</p>
                    </motion.div>
                  );
                })}
              </Stagger>

              <Reveal delay={0.1}>
                <div className="mt-10 flex flex-wrap items-center gap-3">
                  <NeonButton href="/avisa" variant="primary">
                    {a.ctaPrimary}
                    <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                  </NeonButton>
                  <NeonButton href="/registro" variant="ghost">
                    {a.ctaRegister}
                  </NeonButton>
                </div>
              </Reveal>
            </div>

            <Reveal delay={0.15}>
              <WhatsAppMock messages={a.chat as MockMsg[]} status={a.chatStatus} />
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
