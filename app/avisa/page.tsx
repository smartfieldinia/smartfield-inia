import type { Metadata } from "next";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { AvisaLanding } from "@/components/sections/AvisaLanding";

export const metadata: Metadata = {
  title: "Avisa — Asistente Virtual de Información Satelital y Agroclimática · INIA",
  description:
    "Avisos de helada, calor, falta de agua y vigor satelital de tu campo por WhatsApp, y respuestas técnicas con la Biblioteca INIA. Gratis, de INIA.",
  icons: { icon: "/avisa-icon-32.png", apple: "/avisa-icon-180.png" },
  // Instalar Avisa desde la landing abre /app a pantalla completa (PWA).
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Avisa · INIA",
    description: "Avisos de clima y satélite para tu campo, por WhatsApp.",
    images: [{ url: "/avisa-logo.png", width: 1200, height: 550 }],
    type: "website",
  },
};

export default function AvisaPage() {
  return (
    <>
      <Navbar />
      <main>
        <AvisaLanding />
      </main>
      <Footer />
    </>
  );
}
