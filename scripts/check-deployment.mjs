import { readFile } from 'node:fs/promises';

const read = name => readFile(name, 'utf8');
const [release, vercelText, dockerfile, supervisor, entrypoint, renderDeploy, guide] = await Promise.all([
  read('.github/workflows/release.yml'),
  read('vercel.json'),
  read('deploy/render/Dockerfile'),
  read('deploy/render/supervisord.conf'),
  read('deploy/render/entrypoint.py'),
  read('scripts/deploy-render.py'),
  read('RENDER_DEPLOYMENT.md'),
]);

const failures = [];
const requireText = (content, pattern, message) => {
  if (!pattern.test(content)) failures.push(message);
};

requireText(release, /on:\s*\n\s+push:\s*\n\s+branches: \[main\]/, 'release workflow must run on pushes to main');
requireText(release, /workflow_dispatch:/, 'release workflow must retain a manual recovery trigger');
requireText(release, /echo "edge_ref=master"/, 'automatic releases must use the edge repository\'s actual master branch');
requireText(release, /--platform linux\/amd64/, 'Render image must be built for linux/amd64');
requireText(release, /docker push "\$IMAGE:\$GITHUB_SHA"/, 'release must publish the tested backend image');
requireText(release, /RELEASE_IMAGE=\$IMAGE@\$DIGEST/, 'Render release must use an immutable image digest');
requireText(release, /vercel@62\.2\.0 build --prod/, 'Vercel production artifact must be built in CI');
requireText(release, /vercel@62\.2\.0 deploy --prebuilt .*--prod/, 'Vercel must deploy the prebuilt production artifact');

const renderPosition = release.indexOf('Deploy reviewed backend and await readiness');
const vercelPosition = release.indexOf('Configure and deploy Vercel UI');
if (renderPosition < 0 || vercelPosition < 0 || renderPosition >= vercelPosition) {
  failures.push('Render must become ready before the Vercel deployment step');
}

const vercel = JSON.parse(vercelText);
if (vercel.outputDirectory !== 'dist/public') failures.push('Vercel outputDirectory must be dist/public');
const productionApiOrigin = 'https://api.152-70-22-84.sslip.io';
const apiRewrite = vercel.rewrites?.find(item => item.source === '/api/:path*');
if (apiRewrite?.destination !== `${productionApiOrigin}/api/:path*`) {
  failures.push('committed Vercel API rewrite must target the production Oracle API');
}
for (const [source, destinationPath] of [
  ['/health/live', '/health/live'],
  ['/health/ready', '/health/ready'],
  ['/api/health/live', '/health/live'],
  ['/api/health/ready', '/health/ready'],
]) {
  const rewrite = vercel.rewrites?.find(item => item.source === source);
  if (rewrite?.destination !== `${productionApiOrigin}${destinationPath}`) {
    failures.push(`Vercel ${source} must proxy to the backend ${destinationPath} endpoint`);
  }
}
const publicHeaders = vercel.headers?.find(item => item.source === '/:path*')?.headers ?? [];
const headerValue = name => publicHeaders.find(item => item.key.toLowerCase() === name.toLowerCase())?.value;
if (!headerValue('Content-Security-Policy')?.includes("frame-ancestors 'none'")) failures.push('Vercel responses must define a restrictive CSP');
if (headerValue('X-Frame-Options') !== 'DENY') failures.push('Vercel responses must deny framing');
if (!headerValue('Permissions-Policy')) failures.push('Vercel responses must define a Permissions-Policy');

requireText(dockerfile, /^FROM mcr\.microsoft\.com\/dotnet\/aspnet:8\.0-noble AS runtime$/m, 'Render runtime must use the reviewed .NET Ubuntu image');
requireText(dockerfile, /^USER app$/m, 'Render image must run as the non-root app user');
requireText(dockerfile, /ENTRYPOINT \["python3", "\/app\/deploy\/render\/entrypoint\.py"\]/, 'Render image must use the validated bundle entrypoint');
requireText(dockerfile, /HEALTHCHECK[\s\S]*\/health\/live \|\| exit 1/,
  'Render container health must test liveness so migrations do not trigger restart loops');
requireText(release, /RENDER_WEB_SERVICE_ID/, 'release must deploy the scalable Render web service');
requireText(release, /RENDER_WORKER_SERVICE_ID/, 'release must deploy the singleton Render worker service');
requireText(supervisor, /autostart=%\(ENV_WEB_AUTOSTART\)s/, 'web processes must be role-gated');
requireText(supervisor, /autostart=%\(ENV_WORKER_AUTOSTART\)s/, 'worker processes must be role-gated');
requireText(entrypoint, /live = self\.path == '\/health\/live'[\s\S]*self\.send_response\(200 if live else 503\)/,
  'migration startup listener must expose liveness without reporting readiness');
requireText(renderDeploy, /current_live_deploy\(worker_service, 'worker'\)/,
  'Render release must snapshot the live worker deploy before mutation');
requireText(renderDeploy, /current_live_deploy\(web_service, 'web'\)/,
  'Render release must snapshot the live web deploy before mutation');
requireText(renderDeploy, /\/rollback'[\s\S]*\{'deployId': deploy_id\}/,
  'Render release must use the rollback API after a partial failure');
requireText(renderDeploy, /for label, service, readiness_origin in reversed\(changed\)/,
  'Render release must roll back changed services in reverse order');
requireText(renderDeploy, /READINESS_TIMEOUT_SECONDS = 720[\s\S]*readiness did not recover within 12 minutes/,
  'Render release must tolerate bounded transient readiness failures before rollback');
requireText(renderDeploy, /MAX_READINESS_DETAIL_BYTES = 512[\s\S]*response omitted/,
  'Render release must bound readiness error output and omit upstream HTML pages');
requireText(entrypoint, /dashboard database migrations are in progress[\s\S]*timeout=600[\s\S]*device database migrations are in progress[\s\S]*timeout=600/,
  'Render startup must expose bounded dashboard and device migration stages');

const programs = [...supervisor.matchAll(/^\[program:([^\]]+)\]$/gm)].map(match => match[1]).sort();
const expectedPrograms = ['analytics', 'api', 'device', 'identity', 'notification', 'telemetry'];
if (JSON.stringify(programs) !== JSON.stringify(expectedPrograms)) {
  failures.push(`Render bundle must contain exactly six supervised processes: ${expectedPrograms.join(', ')}`);
}

for (const phrase of [
  'push to the dashboard repository\'s protected `main` branch',
  'only production backend image',
  'not a second Docker image',
  'Disable Vercel\'s independent Git production deployment',
  'RENDER_SERVICE_ROLE=web',
  'RENDER_SERVICE_ROLE=worker',
  '| Health check path | `/health/live` | `/health/live` |',
]) {
  if (!guide.includes(phrase)) failures.push(`deployment guide is missing required guidance: ${phrase}`);
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log('Deployment topology and coordinated release configuration are consistent.');
}
