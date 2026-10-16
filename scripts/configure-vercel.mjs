import { readFile, writeFile } from 'node:fs/promises';
const configured = process.env.API_ORIGIN ?? process.env.RENDER_API_ORIGIN;
if (!configured) throw new Error('API_ORIGIN (or legacy RENDER_API_ORIGIN) must be set before Vercel pull/build/deploy');
const origin = new URL(configured);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.hostname.endsWith('.invalid')) {
  throw new Error('API_ORIGIN (or legacy RENDER_API_ORIGIN) must be a real HTTPS origin without credentials, path, query, or fragment');
}
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
