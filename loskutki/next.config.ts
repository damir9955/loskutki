import type { NextConfig } from "next";

/** адрес WS-сервера по умолчанию (Deno Deploy). NEXT_PUBLIC_WS_URL в
 *  окружении Vercel перекрывает; «off»/«none» — принудительно без WS */
const WS_DEFAULT = process.env.NEXT_PUBLIC_WS_URL ?? "https://loskutki.damirkolmurzin.deno.net";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_WS_URL: WS_DEFAULT,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
