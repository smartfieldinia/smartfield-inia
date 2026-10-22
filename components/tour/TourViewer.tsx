"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LogoSFI } from "@/components/ui/LogoSFI";
import { ArrowLeft, X, Info, Compass } from "lucide-react";
import { Viewer } from "@photo-sphere-viewer/core";
import { CubemapAdapter } from "@photo-sphere-viewer/cubemap-adapter";
import { VirtualTourPlugin } from "@photo-sphere-viewer/virtual-tour-plugin";
import { MarkersPlugin } from "@photo-sphere-viewer/markers-plugin";
import { AutorotatePlugin } from "@photo-sphere-viewer/autorotate-plugin";
import "@photo-sphere-viewer/core/index.css";
import "@photo-sphere-viewer/markers-plugin/index.css";
import "@photo-sphere-viewer/virtual-tour-plugin/index.css";
import { TOUR_NODES, FIRST_NODE_ID } from "./tour-data";
import { useLang } from "@/lib/i18n";

type ActiveMarker = { title: string; text: string } | null;

export default function TourViewer() {
  const { t } = useLang();
  const scenes = t.tour.scenes;
  const containerRef = useRef<HTMLDivElement>(null);
  const tourRef = useRef<VirtualTourPlugin | null>(null);
  const [currentNode, setCurrentNode] = useState<string>(FIRST_NODE_ID);
  const [activeMarker, setActiveMarker] = useState<ActiveMarker>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const nodes = TOUR_NODES.map((n) => ({
      id: n.id,
      panorama: n.panorama,
      name: n.name,
      caption: n.caption,
      markers: n.markers.map((m) => ({
        id: m.id,
        position: { yaw: `${m.yaw}deg`, pitch: `${m.pitch}deg` },
        html: `<span class="sf-hotspot"><span class="sf-hotspot-ring"></span><span class="sf-hotspot-dot">i</span></span>`,
        size: { width: 40, height: 40 },
        anchor: "center center",
        tooltip: m.title,
        data: { title: m.title, text: m.text },
      })),
      links: n.links.map((l) => ({
        nodeId: l.nodeId,
        position: { yaw: `${l.yaw}deg`, pitch: `${l.pitch}deg` },
      })),
    }));

    type Plugins = NonNullable<
      ConstructorParameters<typeof Viewer>[0]["plugins"]
    >;
    const plugins: Plugins = [
      [
        VirtualTourPlugin,
        {
          positionMode: "manual",
          renderMode: "3d",
          nodes,
          startNodeId: FIRST_NODE_ID,
        },
      ],
      MarkersPlugin,
    ];
    if (!reduce) {
      plugins.push([
        AutorotatePlugin,
        { autostartDelay: 4000, autorotateSpeed: "0.3rpm" },
      ]);
    }

    const viewer = new Viewer({
      container: containerRef.current,
      adapter: CubemapAdapter,
      defaultYaw: 0,
      navbar: false,
      loadingTxt: "Cargando recorrido 360°…",
      plugins,
    });

    const tour = viewer.getPlugin(VirtualTourPlugin) as VirtualTourPlugin;
    const markers = viewer.getPlugin(MarkersPlugin) as MarkersPlugin;
    tourRef.current = tour;

    viewer.addEventListener("ready", () => setReady(true), { once: true });

    tour.addEventListener("node-changed", (e) => {
      setCurrentNode((e as unknown as { node: { id: string } }).node.id);
      setActiveMarker(null);
    });

    markers.addEventListener("select-marker", (e) => {
      const data = (e as unknown as { marker: { config: { data?: ActiveMarker } } })
        .marker.config.data;
      if (data) setActiveMarker(data);
    });

    return () => {
      try {
        viewer.destroy();
      } catch {
        /* noop */
      }
      tourRef.current = null;
    };
  }, []);

  const goTo = (id: string) => {
    void (
      tourRef.current?.setCurrentNode(id) as unknown as Promise<unknown>
    )?.catch?.(() => {});
  };

  const current = TOUR_NODES.find((n) => n.id === currentNode);

  return (
    <div data-theme="dark" className="fixed inset-0 bg-ink">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Scrims para legibilidad de los textos sobre cualquier panorama */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-36 bg-gradient-to-b from-black/75 via-black/30 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-44 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />

      {/* Loading veil */}
      {!ready && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-ink">
          <div className="flex flex-col items-center gap-4">
            <Compass className="h-8 w-8 animate-spin text-lime" />
            <span className="kicker">{t.tour.loading}</span>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between p-4 sm:p-6">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-full border border-white/15 bg-ink/70 px-4 py-2.5 text-sm font-semibold text-white shadow-lg ring-1 ring-black/20 backdrop-blur-md transition-all hover:border-lime/50 hover:bg-ink/85 hover:text-lime"
        >
          <ArrowLeft size={16} />
          {t.tour.back}
        </Link>
        <div className="flex items-center gap-3">
          <LogoSFI className="h-12 w-auto" priority />
          <span className="hidden font-[family-name:var(--font-display)] text-sm font-semibold text-white sm:inline">
            {t.tour.title}
          </span>
        </div>
      </div>

      {/* Scene title (bottom-left; sube en mobile para no chocar con el selector) */}
      {current && (
        <div className="absolute bottom-24 left-4 z-20 max-w-[70vw] drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] sm:bottom-6 sm:left-6 sm:max-w-xs">
          <span className="kicker">{scenes[current.id]?.caption ?? current.caption}</span>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold text-white sm:text-3xl">
            {scenes[current.id]?.name ?? current.name}
          </h1>
        </div>
      )}

      {/* Scene selector — tira con scroll horizontal en mobile, cluster abajo-derecha en sm+ */}
      <div className="no-scrollbar absolute inset-x-0 bottom-4 z-20 flex gap-2 overflow-x-auto px-4 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:max-w-[60vw] sm:flex-wrap sm:justify-end sm:overflow-visible sm:px-0">
        {TOUR_NODES.map((n, i) => (
          <button
            key={n.id}
            onClick={() => goTo(n.id)}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-semibold backdrop-blur-md transition-all ${
              currentNode === n.id
                ? "border-lime/60 bg-lime/20 text-lime shadow-[0_0_18px_rgba(122,193,67,0.35)]"
                : "border-white/15 bg-ink/70 text-mist ring-1 ring-black/20 hover:border-lime/40 hover:text-white"
            }`}
          >
            <span className="font-[family-name:var(--font-mono)] opacity-60">
              0{i + 1}
            </span>{" "}
            {scenes[n.id]?.name ?? n.name}
          </button>
        ))}
      </div>

      {/* Info panel */}
      {activeMarker && (
        <div className="absolute right-4 top-20 z-30 w-[min(360px,calc(100vw-2rem))] sm:right-6 sm:top-24">
          <div className="relative rounded-2xl border border-lime/30 bg-ink/90 p-6 shadow-[0_8px_40px_rgba(0,0,0,0.5)] ring-1 ring-black/30 backdrop-blur-xl">
            <button
              onClick={() => setActiveMarker(null)}
              className="absolute right-4 top-4 text-mist-soft transition-colors hover:text-lime"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-lime/10 text-lime ring-1 ring-edge">
              <Info size={20} />
            </div>
            <h3 className="mt-4 pr-6 font-[family-name:var(--font-display)] text-lg font-semibold text-white">
              {activeMarker.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-mist-soft">
              {activeMarker.text}
            </p>
          </div>
        </div>
      )}

      {/* Hint */}
      {ready && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-10 -translate-x-1/2 sm:top-24">
          <span className="rounded-full border border-white/15 bg-ink/70 px-4 py-1.5 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-widest text-mist ring-1 ring-black/20 backdrop-blur-md">
            {t.tour.hint}
          </span>
        </div>
      )}

      {/* Estilos de hotspots PSV */}
      <style>{`
        .sf-hotspot {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          cursor: pointer;
        }
        .sf-hotspot-dot {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          border-radius: 9999px;
          background: #7ac143;
          color: #040d0a;
          font-family: var(--font-jetbrains), monospace;
          font-size: 13px;
          font-weight: 700;
          box-shadow: 0 0 16px 3px rgba(122, 193, 67, 0.6);
        }
        .sf-hotspot-ring {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          border: 2px solid rgba(122, 193, 67, 0.5);
          animation: sf-pulse 2s ease-out infinite;
        }
        @keyframes sf-pulse {
          0% { transform: scale(0.7); opacity: 0.8; }
          70% { transform: scale(1.4); opacity: 0; }
          100% { opacity: 0; }
        }
        .psv-container { background: #040d0a !important; }
        .psv-virtual-tour-link-button { filter: drop-shadow(0 0 8px rgba(122,193,67,0.5)); }
      `}</style>
    </div>
  );
}
