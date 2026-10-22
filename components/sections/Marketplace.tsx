"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Camera,
  Droplets,
  Map,
  Cpu,
  Plane,
  Gauge,
  ArrowUpRight,
} from "lucide-react";
import { SectionHeading, Badge } from "@/components/ui/primitives";
import { Reveal, itemVariants } from "@/components/ui/Reveal";
import { Carousel } from "@/components/ui/Carousel";
import { useLang, Highlight } from "@/lib/i18n";

const ICONS = [Camera, Droplets, Map, Cpu, Plane, Gauge];
const HREFS: (string | undefined)[] = ["/plataforma"];

export function Marketplace() {
  const { t } = useLang();

  return (
    <section id="marketplace" className="relative py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <Reveal>
            <SectionHeading
              kicker={t.marketplace.kicker}
              title={<Highlight text={t.marketplace.title} />}
              subtitle={t.marketplace.subtitle}
            />
          </Reveal>
          <Reveal delay={0.1}>
            <Badge>
              <Camera size={14} /> {t.marketplace.badge}
            </Badge>
          </Reveal>
        </div>

        <Carousel
          className="mt-16"
          gridClassName="grid-cols-2 lg:grid-cols-3"
        >
          {t.marketplace.items.map((it, i) => {
            const Icon = ICONS[i];
            const href = HREFS[i];
            const card = (
              <article className="glass group relative flex h-full flex-col overflow-hidden rounded-2xl p-7 transition-all duration-300 hover:border-lime/35 hover:-translate-y-1.5">
                <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-teal/15 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
                <div className="flex items-start justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-lime/10 text-lime ring-1 ring-edge">
                    <Icon size={22} />
                  </div>
                  <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-widest text-mist-soft">
                    {it.tag}
                  </span>
                </div>
                <h3 className="mt-6 flex items-center gap-1.5 font-[family-name:var(--font-display)] text-lg font-semibold text-strong">
                  {it.title}
                  <ArrowUpRight
                    size={16}
                    className="text-lime opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100"
                  />
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-mist-soft">
                  {it.text}
                </p>
                {href && (
                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-lime">
                    {t.marketplace.cta}
                    <ArrowUpRight size={15} />
                  </span>
                )}
              </article>
            );
            return (
              <motion.div key={it.title} variants={itemVariants}>
                {href ? (
                  <Link href={href} className="block h-full">
                    {card}
                  </Link>
                ) : (
                  card
                )}
              </motion.div>
            );
          })}
        </Carousel>
      </div>
    </section>
  );
}
