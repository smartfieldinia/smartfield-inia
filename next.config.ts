import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /campus es un proxy al Chamilo de MochaHost (rewrite en vercel.json).
  // Next le quitaba la barra final ("/campus/main/auth/" → ".../auth") y
  // Chamilo la vuelve a poner con un 301: bucle infinito. Sin esta opción,
  // la URL llega tal cual al rewrite.
  skipTrailingSlashRedirect: true,
  // El asistente pasó a llamarse Avisa (2026-10): /asistente queda como alias
  // permanente para los links ya repartidos (WhatsApp, correos, app.html).
  // Campus Virtual (Chamilo) sigue en MochaHost: se reenvía tal cual, con la
  // barra final incluida (`(.*)` la conserva; `:path*` la perdía).
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/campus", destination: "https://mail.smartfieldinia.cl/campus/" },
        { source: "/campus/:path(.*)", destination: "https://mail.smartfieldinia.cl/campus/:path" },
        // El inicio del campus embebe (iframe) el tour 3DVista "Sala" del curso de
        // riego, que vive en /cursos/ del mismo servidor viejo.
        { source: "/cursos/:path(.*)", destination: "https://mail.smartfieldinia.cl/cursos/:path" },
      ],
    };
  },
  async redirects() {
    // `/cursos/riego/Sala` → `Sala/` vive en vercel.json: acá Next ignora la
    // barra final al comparar y el redirect se aplicaba a sí mismo (bucle).
    return [{ source: "/asistente", destination: "/avisa", permanent: true }];
  },
};

export default nextConfig;
