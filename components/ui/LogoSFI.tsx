import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Logo unificado Smartfield INIA (reemplazó al par "logo INIA + wordmark
 * SmartField" el 2026-08-13). Son dos archivos porque el arte es a color: el
 * de claro va con la tinta teal original y el de oscuro con la tipografía en
 * blanco (isotipo intacto en ambos). El intercambio es CSS puro —
 * `.logo-sfi-*` en globals.css— para que no dependa de JS ni parpadee en la
 * hidratación.
 */

// Logo oficial (~/Desktop/smartfield_inia_logo.png, 2026-10), 1,8:1.
const W = 1200;
const H = 667;

export function LogoSFI({
  className,
  priority = false,
}: {
  /** Altura del logo, p.ej. "h-12 sm:h-20 w-auto". */
  className?: string;
  priority?: boolean;
}) {
  return (
    <>
      <Image
        src="/smartfield-logo.png"
        alt="Smartfield INIA — Instituto de Investigaciones Agropecuarias"
        width={W}
        height={H}
        className={cn("logo-sfi-light", className)}
        priority={priority}
      />
      <Image
        src="/smartfield-logo-dark.png"
        alt=""
        aria-hidden
        width={W}
        height={H}
        className={cn("logo-sfi-dark", className)}
        priority={priority}
      />
    </>
  );
}
