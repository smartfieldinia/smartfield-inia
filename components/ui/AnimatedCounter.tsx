"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";

export function AnimatedCounter({
  value,
  suffix = "",
  prefix = "",
  duration = 1600,
}: {
  value: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  // Inicia en el valor final: así el HTML del SSR (y crawlers / JS deshabilitado)
  // muestran los números reales en vez de "0".
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    // `reduce` e `inView` son estado del navegador (media query y observer): el
    // efecto es el único lugar donde se los conoce. Ver el useState de arriba.
    if (reduce) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplay(value);
      return;
    }
    // Mientras la sección está fuera de vista, resetea a 0 (no se ve, está off-screen)
    // para luego animar 0 → value cuando entra en viewport.
    if (!inView) {
      setDisplay(0);
      return;
    }
    let raf = 0;
    let start: number | null = null;
    const step = (t: number) => {
      if (start === null) start = t;
      const p = Math.min((t - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(eased * value));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration, reduce]);

  return (
    <span ref={ref}>
      {prefix}
      {display.toLocaleString("es-CL")}
      {suffix}
    </span>
  );
}
