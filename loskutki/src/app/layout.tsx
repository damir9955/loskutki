import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { FabricDefs } from "@/components/game/FabricDefs";

export const metadata: Metadata = {
  title: "Лоскутки — пэчворк-дуэль",
  description:
    "Мобильная игра по мотивам настольного Patchwork: сшивайте лоскутное полотно, соревнуясь с хитрым ботом. Дорожка времени, доход, кожаные лоскутки и бонус 7×7.",
  applicationName: "Лоскутки",
  keywords: ["пэчворк", "patchwork", "настольная игра", "лоскутки", "головоломка", "полимино"],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Лоскутки",
  },
  openGraph: {
    title: "Лоскутки — пэчворк-дуэль",
    description: "Сшейте самое красивое лоскутное полотно и обойдите соперника.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#F3E9D2",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased linen-bg min-h-screen">
        <FabricDefs />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
