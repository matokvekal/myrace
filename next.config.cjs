// next.config.cjs
const WorkboxPlugin = require("workbox-webpack-plugin");
const { withInspector } = require("react-dev-inspector/plugins/next");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    API_URL: process.env.API_URL
  },
  publicRuntimeConfig: {
    APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    VERSION: process.env.NEXT_PUBLIC_VERSION
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "maps.googleapis.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" }
    ]
  },
  webpack(config, { isServer, dev }) {
    config.cache = false;
    if (!dev && !isServer) {
      config.module.rules.push(
        { test: /playwright\.config\.ts$/, use: "null-loader" },
        { test: /\.test\.(js|ts)$/, use: "null-loader" }
      );
      config.plugins.push(
        new WorkboxPlugin.GenerateSW({
          clientsClaim: true,
          skipWaiting: true,
          maximumFileSizeToCacheInBytes: 50 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: /^https?.*/,
              handler: "NetworkFirst",
              options: {
                cacheName: "http-cache",
                expiration: { maxEntries: 200, maxAgeSeconds: 86400 }
              }
            }
          ]
        })
      );
    }
    return config;
  }
};

module.exports = withInspector(nextConfig);
