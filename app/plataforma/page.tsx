import type { Metadata } from "next";
import TourClient from "@/components/tour/TourClient";

export const metadata: Metadata = {
  title: "Tour virtual 360° — Smartfield INIA",
  description:
    "Recorre el campo inteligente de INIA en 360°: sensoramiento, riego inteligente, monitoreo satelital y maquinaria AgTech.",
};

export default function PlataformaPage() {
  return <TourClient />;
}
