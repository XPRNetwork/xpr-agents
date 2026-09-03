/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // next/og (ImageResponse) loads its resvg/yoga wasm and index.node.js
  // lazily, which output file tracing misses in serverless functions; include
  // the whole compiled package for the OG card routes.
  outputFileTracingIncludes: {
    '/api/og/**': ['./node_modules/next/dist/compiled/@vercel/og/**/*'],
  },
  async redirects() {
    return [
      {
        source: '/jobs',
        has: [{ type: 'query', key: 'job', value: '(?<id>\\d+)' }],
        destination: '/jobs/:id',
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
