"use client";

import { useState, type ComponentType } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Radio,
  Database,
  Plane,
  Tractor,
  Thermometer,
  CloudSun,
  Layers,
  Satellite,
} from "lucide-react";
import { SectionHeading } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/Reveal";
import { Carousel } from "@/components/ui/Carousel";
import { useLang, Highlight } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const ICONS = [Radio, Database, Layers, Satellite, Plane, Tractor, Thermometer, CloudSun];

export function Tecnologias() {
  const { t } = useLang();
  const [tab, setTab] = useState("todo");

  const items = t.tecnologias.items
    .map((it, i) => ({ ...it, Icon: ICONS[i] }))
    .filter((it) => tab === "todo" || it.cat === tab);

  const catLabel = (cat: string) =>
    t.tecnologias.tabs.find((tb) => tb.key === cat)?.label ?? cat;

  return (
    <section id="tecnologias" className="relative py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Reveal>
          <SectionHeading
            center
            kicker={t.tecnologias.kicker}
            title={<Highlight text={t.tecnologias.title} />}
            subtitle={t.tecnologias.subtitle}
          />
        </Reveal>

        {/* Tabs */}
        <Reveal delay={0.08}>
          <div className="no-scrollbar mt-10 flex justify-start gap-2 overflow-x-auto pb-1 sm:justify-center">
            {t.tecnologias.tabs.map((tb) => (
              <button
                key={tb.key}
                onClick={() => setTab(tb.key)}
                className={`relative shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  tab === tb.key ? "text-onlime" : "text-mist-soft hover:text-mist"
                }`}
              >
                {tab === tb.key && (
                  <motion.span
                    layoutId="tech-tab"
                    className="absolute inset-0 rounded-full bg-lime"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <span className="relative z-10">{tb.label}</span>
              </button>
            ))}
          </div>
        </Reveal>

        <Carousel
          className="mt-10"
          gridClassName="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
        >
          {items.map((it) => (
            <motion.div
              key={it.title}
              layout
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
            >
              <TechCard
                Icon={it.Icon}
                title={it.title}
                text={it.text}
                catLabel={catLabel(it.cat)}
                flipHint={t.tecnologias.flipHint}
                flipBack={t.tecnologias.flipBack}
              />
            </motion.div>
          ))}
        </Carousel>
      </div>
    </section>
  );
}

function TechCard({
  Icon,
  title,
  text,
  catLabel,
  flipHint,
  flipBack,
}: {
  Icon: ComponentType<{ size?: number }>;
  title: string;
  text: string;
  catLabel: string;
  flipHint: string;
  flipBack: string;
}) {
  const [flipped, setFlipped] = useState(false);
  const reduce = useReducedMotion();

  return (
    <button
      type="button"
      onClick={() => setFlipped((f) => !f)}
      aria-pressed={flipped}
      aria-label={flipped ? `${title}. ${flipBack}` : `${title}. ${flipHint}`}
      className={cn(
        "flip-card group block h-56 w-full cursor-pointer text-left",
        flipped && "is-flipped",
        reduce && "[&_.flip-card-inner]:transition-none",
      )}
    >
      <div className="flip-card-inner">
        {/* Frente */}
        <div className="flip-card-face glass flex h-full flex-col items-center justify-center gap-3 rounded-2xl p-7 text-center transition-colors duration-300 group-hover:border-lime/35">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-lime/10 text-lime ring-1 ring-edge transition-colors group-hover:bg-lime/20">
            <Icon size={24} />
          </div>
          <span className="text-sm font-medium leading-snug text-mist">{title}</span>
          <span className="text-[11px] text-mist-soft/70">{flipHint}</span>
        </div>

        {/* Reverso */}
        <div className="flip-card-face flip-card-back glass flex h-full flex-col items-center justify-center gap-3 rounded-2xl border-lime/30 bg-lime/[0.04] p-6 text-center">
          <span className="rounded-full bg-lime/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-lime">
            {catLabel}
          </span>
          <p className="text-sm leading-relaxed text-mist">{text}</p>
          <span className="text-[11px] text-mist-soft/70">{flipBack}</span>
        </div>
      </div>
    </button>
  );
}
