import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phones reach the dev server through a tunnel or the LAN; allow those origins for dev assets.
  allowedDevOrigins: ["*.trycloudflare.com", "*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app", "*.ngrok.io", "*.loca.lt", "192.168.*.*", "10.*.*.*"],
};

export default nextConfig;
