import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Resuelve un enlace de ancla según la página en la que estemos.
 *
 * El Navbar y el Footer se usan tanto en la home como en /asistente, pero sus
 * enlaces son anclas ("#que-es", "#marketplace"…) que **solo existen en la
 * home**. En /asistente hacían literalmente nada: cambiaban el hash de la URL
 * y ahí quedaba, incluido el logo, que no permitía volver al inicio.
 *
 * Fuera de la home se les antepone "/" para que naveguen a la home y bajen a
 * la sección; en la home se dejan tal cual, para conservar el scroll suave.
 */
export function anclaHome(href: string, pathname: string) {
  if (!href.startsWith("#")) return href;
  return pathname === "/" ? href : `/${href}`;
}
