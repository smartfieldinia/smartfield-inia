"use client";

import { SectionHeading } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/Reveal";
import { useLang, Highlight } from "@/lib/i18n";

const PARTNERS = [
  "OneSoil",
  "Auravant",
  "Mapsens",
  "Agroprecisión",
  "Geotrace",
  "MindLabs",
  "Morpho",
  "Neltume",
  "The Earthsays",
  "Olivos.cl",
  "Soval Agrícola",
  "Impac",
  "Tecnomundo",
];

export function Partners() {
  const { t } = useLang();
  return (
    <section className="relative py-10 sm:py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Reveal>
          <SectionHeading
            center
            kicker={t.partners.kicker}
            title={<Highlight text={t.partners.title} />}
          />
        </Reveal>
      </div>

      <Reveal delay={0.1}>
        <div className="marquee-mask group relative mt-10 flex w-full max-w-full overflow-hidden">
          {[0, 1].map((copy) => (
            <div
              key={copy}
              className="animate-marquee flex shrink-0 items-center gap-4 pr-4 group-hover:[animation-play-state:paused]"
              aria-hidden={copy === 1}
            >
              {PARTNERS.map((p) => (
                <span
                  key={p}
                  className="glass whitespace-nowrap rounded-full px-6 py-3 font-[family-name:var(--font-display)] text-sm font-semibold text-mist"
                >
                  {p}
                </span>
              ))}
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
