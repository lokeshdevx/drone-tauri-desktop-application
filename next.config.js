/** @type {import('next').NextConfig} */
const path = require("path");

const nextConfig = {
  output: "export",
  distDir: "out",
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: false, // Disable StrictMode — it double-invokes effects
  // which causes WS connect→disconnect loops in Tauri
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.resolve(__dirname, "src"),
    };
    config.plugins.push(
      new (require("webpack").IgnorePlugin)({
        resourceRegExp: /^@tauri-apps\//,
      }),
    );
    return config;
  },
};

module.exports = nextConfig;
