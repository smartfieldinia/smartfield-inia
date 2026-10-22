import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/sections/Hero";
import { QueEs } from "@/components/sections/QueEs";
import { Marketplace } from "@/components/sections/Marketplace";
import { Satelital } from "@/components/sections/Satelital";
import { Tecnologias } from "@/components/sections/Tecnologias";
import { LosTilos } from "@/components/sections/LosTilos";
import { Nosotros } from "@/components/sections/Nosotros";
import { PlataformasComplementarias } from "@/components/sections/PlataformasComplementarias";
import { Partners } from "@/components/sections/Partners";
import { Respaldo } from "@/components/sections/Respaldo";
import { CTA } from "@/components/sections/CTA";
import { AvisaHome } from "@/components/sections/AvisaHome";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <QueEs />
        <AvisaHome />
        <Satelital />
        <Marketplace />
        <Tecnologias />
        <LosTilos />
        <Nosotros />
        <PlataformasComplementarias />
        <Partners />
        <Respaldo />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
