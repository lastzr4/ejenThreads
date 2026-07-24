import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterServiceWorker } from "@/components/register-service-worker";

export const metadata: Metadata = {
  title: "CopyCreator",
  description: "Study successful Threads creators and generate on-brand posts in their style.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CopyCreator"
  }
};

// Separate from `metadata` per Next 14's viewport API — themeColor tints the
// mobile browser chrome/status bar, and maximumScale: 1 keeps form-heavy
// pages (lots of small inputs/buttons) from accidentally pinch-zooming on
// phone taps, closer to how an installed native-feeling app behaves.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0f172a"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
