import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CopyCreator",
  description: "Study successful Threads creators and generate on-brand posts in their style."
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
