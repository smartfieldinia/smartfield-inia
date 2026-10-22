"use client";

import dynamic from "next/dynamic";

const TourViewer = dynamic(() => import("./TourViewer"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 flex items-center justify-center bg-ink">
      <span className="kicker">Cargando recorrido 360°</span>
    </div>
  ),
});

export default function TourClient() {
  return <TourViewer />;
}
