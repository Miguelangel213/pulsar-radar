const API = process.env.RADAR_API_URL || "http://localhost:8000";

/** @type {import('next').NextConfig} */
export default {
  // El navegador llama a /api/* y Next lo reenvía al backend local (sin CORS).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/:path*` }];
  },
};
