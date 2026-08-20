import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright-core + @sparticuz/chromium ship native binaries/large brotli
  // assets that must not be bundled by webpack — use native require instead.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
};

export default nextConfig;
