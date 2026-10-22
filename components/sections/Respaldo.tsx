"use client";

import { motion } from "framer-motion";
import { SectionHeading } from "@/components/ui/primitives";
import { Reveal, Stagger, itemVariants } from "@/components/ui/Reveal";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { useLang, Highlight } from "@/lib/i18n";

const VALUES = [
  { value: 11, suffix: "" },
  { value: 432, suffix: "" },
  { value: 19, suffix: "K+" },
  { value: 16, suffix: "" },
];

export function Respaldo() {
  const { t } = useLang();
  return (
    <section id="respaldo" className="relative py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Reveal>
          <SectionHeading
            center
            kicker={t.respaldo.kicker}
            title={<Highlight text={t.respaldo.title} />}
            subtitle={t.respaldo.subtitle}
          />
        </Reveal>

        <Stagger className="mt-16 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {t.respaldo.stats.map((s, i) => (
            <motion.div key={s.label} variants={itemVariants}>
              <div className="glass relative h-full overflow-hidden rounded-2xl p-8 text-center">
                <div className="font-[family-name:var(--font-display)] text-4xl font-bold text-gradient sm:text-5xl">
                  <AnimatedCounter value={VALUES[i].value} suffix={VALUES[i].suffix} />
                </div>
                <p className="mt-3 text-sm leading-snug text-mist-soft">
                  {s.label}
                </p>
              </div>
            </motion.div>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
