import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import { InteractiveBackground } from "@/components/ui/InteractiveBackground";
import { Providers } from "./providers";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://smartfieldinia.cl"),
  title: "Smartfield INIA — Agricultura 4.0",
  description:
    "Plataforma de agricultura inteligente de INIA: tour virtual 360°, monitoreo satelital de riego, sensoramiento, big data y asesoría tecnológica para el campo de Chile.",
  keywords: [
    "INIA",
    "Smartfield",
    "agricultura 4.0",
    "monitoreo satelital",
    "riego inteligente",
    "AgTech Chile",
  ],
  openGraph: {
    title: "Smartfield INIA — Agricultura 4.0",
    description:
      "El campo inteligente de Chile: tecnología satelital, sensoramiento y big data al servicio de la agricultura.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('sf-theme');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light');var l=localStorage.getItem('sf-lang');if(l)document.documentElement.lang=l;}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`,
          }}
        />
      </head>
      <body
        className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrains.variable} antialiased`}
      >
        <div className="bg-field" aria-hidden />
        <div className="bg-grid" aria-hidden />
        <div className="bg-spot" aria-hidden />
        <InteractiveBackground />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
