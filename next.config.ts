import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const backend = (process.env.BACKEND_URL || "http://localhost:4000").replace(/\/$/, "");
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
  reactCompiler: true,
  experimental: {
    proxyTimeout: 120_000,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'atsicusbhiujthlshszg.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/quick-clinic-avatars/**',
      },
    ],
  },
  // Add empty turbopack config to silence warning
  turbopack: {},
};

export default nextConfig;
