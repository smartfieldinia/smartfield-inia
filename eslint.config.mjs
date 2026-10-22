import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // El output del build de Vercel: bundles minificados que aportaban 3.697 de
    // los 4.226 avisos que tenía este proyecto. Lintear artefactos generados no
    // encuentra un solo defecto y esconde los que sí importan.
    ".vercel/**",
    // Las páginas estáticas tienen su JS embebido en el HTML: ESLint no lo lee.
    // Su red es `node scripts/probar-app-html.js`.
    "public/**",
  ]),
  {
    // Vercel Functions y scripts de Node: son CommonJS por definición del
    // runtime, así que `require()` no es una elección de estilo — es la única
    // forma que corre. La regla de TypeScript marcaba 224 errores por eso solo.
    files: ["api/**/*.js", "scripts/**/*.js", "eval/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-this-alias": "off",
      // `catch (_) {}` deliberado: hay decenas, y son el patrón best-effort del
      // proyecto (una memoria que no se pudo guardar no debe tumbar la respuesta).
      "@typescript-eslint/no-unused-vars": ["warn", { caughtErrors: "none", argsIgnorePattern: "^_" }],
    },
  },
]);

export default eslintConfig;
