"use client";

import { motion, useReducedMotion } from "framer-motion";
import { CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoAvisa } from "@/components/ui/LogoAvisa";

export type MockMsg = { from: "avisa" | "user"; text: string; time: string };

/**
 * Maqueta de una conversación de WhatsApp con Avisa. Ilustrativa: los textos
 * vienen de translations.ts y siguen el tono real del bot (corto, sin cerrar
 * con pregunta, a escala de campo).
 */
export function WhatsAppMock({
  messages,
  status,
  className,
}: {
  messages: MockMsg[];
  status: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-sm overflow-hidden rounded-[2rem] border border-edge bg-white shadow-[0_24px_60px_rgba(11,43,37,0.18)]",
        className,
      )}
    >
      <div className="flex items-center gap-3 bg-[#0e6b5c] px-4 py-3 text-white">
        <LogoAvisa icon className="h-9 w-9 bg-white" />
        <div className="leading-tight">
          <div className="text-sm font-semibold">Avisa INIA</div>
          <div className="text-[11px] text-white/75">{status}</div>
        </div>
      </div>
      <div className="flex flex-col gap-2 bg-[#efeae2] px-3 py-4">
        {messages.map((m, i) => (
          <motion.div
            key={i}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.25 + i * 0.35 }}
            className={cn(
              "max-w-[85%] whitespace-pre-line rounded-xl px-3 py-2 text-[13px] leading-snug text-[#111b21] shadow-sm",
              m.from === "user" ? "self-end rounded-tr-sm bg-[#d9fdd3]" : "self-start rounded-tl-sm bg-white",
            )}
          >
            {m.text}
            <span className="ml-2 inline-flex translate-y-0.5 items-center gap-0.5 text-[10px] text-[#667781]">
              {m.time}
              {m.from === "user" && <CheckCheck size={12} className="text-[#53bdeb]" />}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
