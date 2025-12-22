import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // Exclude socket-server from build (handled by tsconfig.json exclude)
  // Add empty turbopack config to silence warning
  turbopack: {},
};

export default nextConfig;
