/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // Chart fonts for the Walmart weekly report are read from disk at runtime.
  experimental: {
    // @napi-rs/canvas is a native module; keep it out of the webpack bundle.
    serverComponentsExternalPackages: ['@napi-rs/canvas'],
    outputFileTracingIncludes: { '/api/walmart/weekly-report/generate': ['./src/lib/walmartWeekly/fonts/**'] },
  },
}

module.exports = nextConfig
