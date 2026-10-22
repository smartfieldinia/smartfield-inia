import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Logos oficiales de Avisa (Asistente Virtual de Información Satelital y
 * Agroclimática), tal cual vienen en ~/Desktop/AVISA: `avisa-web.png` (solo se
 * le quitó el fondo blanco) y el círculo `avisa-whatsapp.png` para `icon`.
 * Sin recolorear: en oscuro el logo va sobre una placa blanca (`.logo-avisa`
 * en globals.css).
 */

const W = 1400;
const H = 642;

export function LogoAvisa({
  className,
  priority = false,
  icon = false,
}: {
  className?: string;
  priority?: boolean;
  icon?: boolean;
}) {
  if (icon) {
    return (
      <Image
        src="/avisa-icon-192.png"
        alt="Avisa"
        width={192}
        height={192}
        className={cn("rounded-full", className)}
        priority={priority}
      />
    );
  }
  return (
    <Image
      src="/avisa-logo.png"
      alt="Avisa — Asistente Virtual de Información Satelital y Agroclimática · INIA"
      width={W}
      height={H}
      className={cn("logo-avisa", className)}
      priority={priority}
    />
  );
}

/** Número productivo de WhatsApp (Kapso, +1 208-203-5994): mismo que auth-common.js. */
export const AVISA_WA = "12082035994";
export const AVISA_WA_URL = `https://wa.me/${AVISA_WA}?text=${encodeURIComponent("Hola Avisa")}`;
