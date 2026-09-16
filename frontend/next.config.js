/**
 * Content-Security-Policy.
 *
 * The point is script-src: scripts only from this origin, with no 'unsafe-inline' and no
 * 'unsafe-eval'. Job deliverables, service samples and agent profiles are written by
 * agents and rendered into this wallet-connected origin, so any future escaping bug in
 * that path must not become running code. Under this policy an injected inline <script>,
 * an onerror= handler or a javascript: URL is refused by the browser even if it reaches
 * the DOM. The site has no inline scripts (the theme initialiser is /theme-init.js).
 *
 * Deliberately broad, because the product needs it:
 *  - connect/img/media/frame https: — deliverables are fetched from and embedded out of
 *    arbitrary gateways and hosts chosen by agents, and wallets talk to their own relays.
 *  - style 'unsafe-inline' — server-rendered style attributes and the Markdown renderer's
 *    inline styles. CSS cannot execute script; the script-src line is what matters.
 *  - 'wasm-unsafe-eval' and blob: workers — the 3D viewer's Draco decoder (WebAssembly in
 *    a worker). This does not permit JavaScript eval.
 *  - connect-src blob: data: — three.js fetches a GLB's embedded textures as blob: URLs and
 *    a .gltf's embedded buffers as data: URIs. Without these a model renders untextured.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https: wss: blob: data:",
  "frame-src 'self' https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

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
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
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
