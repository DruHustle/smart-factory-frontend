import { readFile, writeFile } from 'node:fs/promises';
const configured = process.env.API_ORIGIN ?? process.env.RENDER_API_ORIGIN;
if (!configured) throw new Error('API_ORIGIN (or legacy RENDER_API_ORIGIN) must be set before Vercel pull/build/deploy');
function httpsOrigin(value, label) {
  try {
    const origin = new URL(value);
    if (origin.protocol === 'https:' && (value === origin.origin || value === `${origin.origin}/`) && !origin.hostname.endsWith('.invalid')) return origin;
  } catch {
    // Configuration errors must not echo a malformed URL containing credentials.
  }
  throw new Error(`${label} must be a real HTTPS origin without credentials, path, query, or fragment`);
}
const origin = httpsOrigin(configured, 'API_ORIGIN (or legacy RENDER_API_ORIGIN)');
if (process.env.RELEASE_ORIGIN !== undefined) httpsOrigin(process.env.RELEASE_ORIGIN, 'RELEASE_ORIGIN');
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
config.rewrites = [
  { source: '/health/live', destination: `${origin.origin}/health/live` },
  { source: '/health/ready', destination: `${origin.origin}/health/ready` },
  { source: '/api/health/live', destination: `${origin.origin}/health/live` },
  { source: '/api/health/ready', destination: `${origin.origin}/health/ready` },
  { source: '/api/:path*', destination: `${origin.origin}/api/:path*` },
  { source: '/:path*', destination: '/index.html' },
];
await writeFile('vercel.json', JSON.stringify(config, null, 2) + '\n');
console.log('Vercel API proxy configured. Build VITE_API_URL=/api.');
