import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { FabricDefs } from "@/components/game/FabricDefs";

/** До-гидрационный скрипт: если маркер «игра полностью скачана» есть,
 *  ставим html[data-boot=ready] — CSS мгновенно прячет вуаль загрузки,
 *  и повторный запуск открывается сразу, без единого мигания.
 *  Идентификатор маркера синхронизирован с src/lib/version.ts. */
const BOOT_PRECHECK = `try{if(localStorage.getItem('loskutki.boot')){document.documentElement.setAttribute('data-boot','ready')}}catch(e){}`;

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
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_PRECHECK }} />
      </head>
      <body className="antialiased linen-bg min-h-screen">
        <FabricDefs />
        {/* BootGate живёт внутри игровой страницы (src/app/page.tsx):
          служебные страницы вроде /privacy открываются без экрана
          загрузки — важно для ссылки на политику конфиденциальности */}
        {children}
        <Toaster />
      </body>
    </html>
  );
}
