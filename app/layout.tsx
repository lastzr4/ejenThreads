import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TTAgent — Threads Agent",
  description: "Analyze Threads creators, generate on-brand posts, and schedule them automatically."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
