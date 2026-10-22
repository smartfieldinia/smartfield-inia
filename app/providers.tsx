"use client";

import type { ReactNode } from "react";
import { LangProvider } from "@/lib/i18n";
import { LightboxProvider } from "@/components/ui/Lightbox";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <LangProvider>
      <LightboxProvider>{children}</LightboxProvider>
    </LangProvider>
  );
}
