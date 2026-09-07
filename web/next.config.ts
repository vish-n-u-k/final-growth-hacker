import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['postgres', 'pg', 'cheerio', 'nodemailer'],
};

export default nextConfig;
