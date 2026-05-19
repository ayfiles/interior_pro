import type { NextConfig } from "next";
import path from "node:path";

const workspaceRoot = path.resolve(process.cwd(), "../..");
const supabaseHostname = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : "tjwqzjzgokfmrzesbulu.supabase.co";

const nextConfig: NextConfig = {
  reactCompiler: true,
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
  turbopack: {
    root: workspaceRoot,
  },
  transpilePackages: [
    "@interior-pro/shared",
    "@interior-pro/supabase",
    "@interior-pro/billing",
    "@interior-pro/pipeline",
    "@interior-pro/video",
  ],
  serverExternalPackages: [
    "@ffmpeg-installer/ffmpeg",
    "@ffprobe-installer/ffprobe",
    "@remotion/bundler",
    "@remotion/renderer",
  ],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: supabaseHostname,
      },
    ],
  },
};

export default nextConfig;
