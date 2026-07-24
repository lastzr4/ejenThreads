"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/creators", label: "Creators" },
  { href: "/dashboard/drafts", label: "Drafts" },
  { href: "/dashboard/schedules", label: "Schedules" },
  { href: "/dashboard/settings", label: "Settings" }
];

/**
 * The dashboard header nav used to be one plain flex row of 5 links, which
 * on a phone-width screen either overflowed or wrapped awkwardly under the
 * logo/email/Sign out — the actual layout has now been widely used on
 * mobile, so this splits into a horizontal nav on md+ screens (unchanged
 * desktop look) and a hamburger-triggered dropdown below md, matching how a
 * PWA is expected to behave on a phone.
 */
export function DashboardNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav className="hidden items-center gap-4 text-sm text-slate-600 md:flex">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="hover:text-slate-900">
            {link.label}
          </Link>
        ))}
      </nav>

      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-2 text-slate-600 hover:bg-slate-100 md:hidden"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-20 border-b border-slate-200 bg-white px-6 py-3 shadow-sm md:hidden">
          <nav className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
