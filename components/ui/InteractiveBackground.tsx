"use client";

import { useEffect, useRef } from "react";

/**
 * Fondo global interactivo: constelación de nodos que cubre todo el viewport,
 * se conecta al cursor y reacciona a él, + actualiza el spotlight (--spot-x/y).
 * Theme-aware (lima en dark / teal en light). Se desactiva con prefers-reduced-motion.
 */
export function InteractiveBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const root = document.documentElement;

    // Color theme-aware
    let rgb = "122, 193, 67"; // lima (dark)
    const readTheme = () => {
      rgb = root.getAttribute("data-theme") === "light" ? "14, 147, 132" : "122, 193, 67";
    };
    readTheme();
    const themeObs = new MutationObserver(readTheme);
    themeObs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    type P = { x: number; y: number; vx: number; vy: number };
    let points: P[] = [];

    // Puntero (en coords CSS). Arranca fuera de pantalla.
    const pointer = { x: -9999, y: -9999, active: false };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // densidad escalada al área, menos en mobile
      const area = width * height;
      const target = width < 640 ? area / 26000 : area / 15000;
      const count = Math.max(18, Math.min(110, Math.floor(target)));
      points = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
      }));
    };

    const MAX = 130;
    const MOUSE = 170;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      for (const p of points) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        // repulsión suave del cursor
        if (pointer.active) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < MOUSE * MOUSE && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const force = (1 - d / MOUSE) * 0.6;
            p.x += (dx / d) * force;
            p.y += (dy / d) * force;
          }
        }
      }

      // líneas entre nodos
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const a = points[i];
          const b = points[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < MAX) {
            const alpha = (1 - dist / MAX) * 0.32;
            ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // líneas hacia el cursor + nodos
      for (const p of points) {
        if (pointer.active) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const dist = Math.hypot(dx, dy);
          if (dist < MOUSE) {
            const alpha = (1 - dist / MOUSE) * 0.5;
            ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(pointer.x, pointer.y);
            ctx.stroke();
          }
        }
        ctx.fillStyle = `rgba(${rgb}, 0.85)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    let raf = 0;
    let running = true;
    const loop = () => {
      if (!running) return;
      draw();
      raf = requestAnimationFrame(loop);
    };

    // Puntero + spotlight (throttle por rAF)
    let queued = false;
    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
      if (!queued) {
        queued = true;
        requestAnimationFrame(() => {
          root.style.setProperty("--spot-x", `${e.clientX}px`);
          root.style.setProperty("--spot-y", `${e.clientY}px`);
          queued = false;
        });
      }
    };
    const onLeave = () => {
      pointer.active = false;
      pointer.x = -9999;
      pointer.y = -9999;
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!reduce) {
        running = true;
        loop();
      }
    };

    let resizeT: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => {
        resize();
        if (reduce) draw();
      }, 150);
    };

    resize();
    if (reduce) {
      draw();
    } else {
      loop();
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerleave", onLeave);
      document.addEventListener("visibilitychange", onVisibility);
    }
    window.addEventListener("resize", onResize);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      clearTimeout(resizeT);
      themeObs.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[-1] h-full w-full opacity-70"
    />
  );
}
