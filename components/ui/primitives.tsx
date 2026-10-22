"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ---------------- SectionHeading ---------------- */
export function SectionHeading({
  kicker,
  title,
  subtitle,
  center,
  className,
}: {
  kicker?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  center?: boolean;
  className?: string;
}) {
  return (
    <div className={cn(center && "text-center mx-auto", "max-w-3xl", className)}>
      {kicker && (
        <span className="kicker inline-flex items-center gap-2">
          <span className="h-px w-6 bg-lime/60" />
          {kicker}
        </span>
      )}
      <h2 className="mt-4 font-[family-name:var(--font-display)] text-3xl sm:text-4xl md:text-5xl font-bold leading-[1.08] tracking-tight text-strong">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-5 text-base sm:text-lg leading-relaxed text-mist-soft">
          {subtitle}
        </p>
      )}
    </div>
  );
}

/* ---------------- Badge ---------------- */
export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-edge bg-lime/5 px-3.5 py-1.5 text-xs font-medium text-lime",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------------- NeonButton ---------------- */
type ButtonProps = {
  children: ReactNode;
  href?: string;
  variant?: "primary" | "ghost";
  className?: string;
};

export function NeonButton({
  children,
  href = "#",
  variant = "primary",
  className,
}: ButtonProps) {
  const base =
    "group relative inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all duration-300";
  const styles =
    variant === "primary"
      ? "bg-lime text-onlime hover:shadow-[0_0_30px_rgba(122,193,67,0.5)] hover:-translate-y-0.5"
      : "glass text-mist hover:text-strong hover:border-lime/40 hover:-translate-y-0.5";

  return (
    <Link href={href} className={cn(base, styles, className)}>
      {children}
    </Link>
  );
}

/* ---------------- GlassCard ---------------- */
export function GlassCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "glass group relative overflow-hidden rounded-2xl p-6 transition-all duration-300 hover:border-lime/35 hover:-translate-y-1",
        className,
      )}
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-lime/10 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
      {children}
    </div>
  );
}
