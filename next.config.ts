import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright opens the local development server through this loopback host.
  // Production deployments are unaffected by this development-only allowlist.
  allowedDevOrigins: ["127.0.0.1"],
  // The framework's bottom-left dev badge overlaps the first control in the
  // phone session dock. Runtime and compile errors still surface normally.
  devIndicators: false,
  poweredByHeader: false,
};

export default nextConfig;
