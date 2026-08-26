"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { istClock } from "@/lib/format";

const NAV = [
  { href: "/", label: "Command" },
  { href: "/queue", label: "Queue" },
  { href: "/promises", label: "Promises" },
  { href: "/audit", label: "Audit" },
  { href: "/policy", label: "Policy" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [clock, setClock] = useState("--:--:--");

  useEffect(() => {
    const tick = () => setClock(istClock());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-gold/25 px-5 py-3 flex items-center gap-6 sticky top-0 z-30 bg-black/90 backdrop-blur">
        <Link href="/" className="shrink-0">
          <div className="text-lg font-semibold tracking-tight leading-none text-gold">RecoverAI</div>
        </Link>
        <nav className="flex gap-1 text-sm">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-md ${
                  active
                    ? "bg-gold/10 text-gold border border-gold/30"
                    : "text-muted hover:text-gold border border-transparent"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-xs text-muted">
          <span>Nivaara · collections desk</span>
          <span className="font-mono text-gold-dim tabular">IST {clock}</span>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
