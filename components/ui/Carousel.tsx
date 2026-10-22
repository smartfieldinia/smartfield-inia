"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * En mobile: carrusel deslizable (scroll-snap) con dots.
 * En sm+: grilla normal (gridClassName). Cada hijo es un item.
 */
export function Carousel({
  children,
  gridClassName,
  className,
}: {
  children: ReactNode[];
  gridClassName: string;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const count = children.length;

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => {
      const items = Array.from(track.children) as HTMLElement[];
      const center = track.scrollLeft + track.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      items.forEach((el, i) => {
        const elCenter = el.offsetLeft + el.offsetWidth / 2;
        const d = Math.abs(elCenter - center);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setActive(best);
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => track.removeEventListener("scroll", onScroll);
  }, []);

  const goTo = (i: number) => {
    const track = trackRef.current;
    if (!track) return;
    const el = track.children[i] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  return (
    <div className={className}>
      {/* mobile: tira con snap | sm+: grilla */}
      <div
        ref={trackRef}
        className={cn(
          "no-scrollbar flex max-w-full snap-x snap-mandatory gap-4 overflow-x-auto pb-1 sm:gap-6 sm:overflow-visible sm:pb-0",
          `sm:grid ${gridClassName}`,
        )}
      >
        {children.map((child, i) => (
          <div
            key={i}
            className="w-[82%] shrink-0 snap-center sm:w-auto sm:shrink"
          >
            {child}
          </div>
        ))}
      </div>

      {/* dots (solo mobile) */}
      <div className="mt-5 flex justify-center gap-2 sm:hidden">
        {Array.from({ length: count }).map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            aria-label={`Ir al ítem ${i + 1}`}
            className={cn(
              "h-2 rounded-full transition-all",
              i === active ? "w-6 bg-lime" : "w-2 bg-mist-soft/40",
            )}
          />
        ))}
      </div>
    </div>
  );
}
