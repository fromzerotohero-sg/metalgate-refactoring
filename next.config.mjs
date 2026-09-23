/** @type {import('next').NextConfig} */
const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "https://api.fromzerotohero.io/api").replace(/\/$/, "");

const nextConfig = {
  images: { unoptimized: true },
  // Same-origin proxy verso l'API SilverGate: il pannello admin chiama /api/admin/*
  // senza CORS e senza nuove variabili d'ambiente.
  rewrites: async () => [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }]
};

export default nextConfig;
