const API = process.env.RADAR_API_URL || "http://localhost:8000";
const STATIC = process.env.NEXT_PUBLIC_STATIC === "1";

/** @type {import('next').NextConfig} */
export default STATIC
  ? {
      // Modo estático (GitHub Pages): sin servidor. El motor corre en el navegador y llama directo a DexScreener.
      output: "export",
      basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
      trailingSlash: true,
      images: { unoptimized: true },
    }
  : {
      // Modo local: el navegador llama a /api/* y Next lo reenvía al backend (sin CORS).
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${API}/:path*` }];
      },
    };
