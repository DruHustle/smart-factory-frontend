import { readFile } from 'node:fs/promises';
const read=name=>readFile(name,'utf8');
const [workflow,legacy,vercelText,dockerfile,supervisor,entrypoint,compose,guide,verifier]=await Promise.all([
 read('.github/workflows/deploy-vercel-oracle.yml'),read('.github/workflows/release.yml'),read('vercel.json'),
 read('deploy/render/Dockerfile'),read('deploy/render/supervisord.conf'),read('deploy/render/entrypoint.py'),
 read('deploy/oracle/compose.yaml'),read('deploy/oracle/README.md'),read('scripts/verify-runtime.mts'),
]);
const failures=[];
const requireText=(content,pattern,message)=>{if(!pattern.test(content))failures.push(message);};
requireText(workflow,/workflow_run:[\s\S]*Dashboard quality checks[\s\S]*branches: \[main\]/,'UI release must wait for main quality checks');
requireText(workflow,/successful push CI|No successful push CI/,'Manual promotion must still require successful CI for the exact revision');
requireText(workflow,/workflow_dispatch:[\s\S]*expected_sha:[\s\S]*required: true/,'Manual dispatch must require the approved immutable source');
requireText(workflow,/run-name: UI \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\} \$\{\{ inputs\.request_id \|\| 'automatic' \}\}/,'Manual dispatch receipts must identify the resolved source and request ID');
const dispatchGuard=workflow.indexOf('"$EXPECTED_SHA" == "$GITHUB_SHA"'),firstSourceLookup=workflow.indexOf('current=$(gh api');
if(!(dispatchGuard>=0&&dispatchGuard<firstSourceLookup&&dispatchGuard<workflow.indexOf('actions/checkout@')))failures.push('Manual SHA binding must fail before source lookup, checkout or deployment');
requireText(workflow,/EXPECTED_SHA: \$\{\{ inputs\.expected_sha \}\}/,'The manual SHA guard must receive the requested workflow input');
requireText(legacy,/RENDER_ROLLBACK_ENABLED/,'Legacy Render release must remain explicitly gated');
const promotion=workflow.indexOf('vercel@62.2.0 deploy --prebuilt'),beforePromotion=workflow.slice(0,promotion),build=beforePromotion.indexOf('vercel@62.2.0 build --prod'),lastContract=beforePromotion.lastIndexOf('node --import tsx scripts/verify-runtime.mts'),lastHead=beforePromotion.lastIndexOf('current=$(gh api');
if(!(build>=0&&lastContract>build&&lastHead>lastContract&&promotion>lastHead))failures.push('Compatibility and current-main checks must immediately precede artifact promotion after build');
requireText(workflow,/RELEASE_SHA.*==.*current/,'Final head check must refuse an obsolete main artifact');
requireText(verifier,/promotionCompatibility\(contract,[\s\S]*schemaDigest: expected\.digest/,'Promotion must verify the exact qualified API, worker, migrations and companion sources');
requireText(verifier,/deploy\/qualification-sources\.json/,'Promotion must load the qualified immutable companion sources');
requireText(workflow,/deploy --prebuilt[\s\S]*scripts\/verify-release\.mts/,'The deployed frontend must attest the approved revision after promotion');
requireText(workflow,/API_ORIGIN=https:\/\/smart-factory-iot-app\.vercel\.app.*scripts\/verify-runtime\.mts/,'The promoted UI origin must proxy the qualified API');
const vercel=JSON.parse(vercelText),origin='https://api.152-70-22-84.sslip.io';
if(vercel.git?.deploymentEnabled?.main!==false)failures.push('Independent Vercel main deploys must stay disabled');
if(vercel.headers?.find(x=>x.source==='/release.json')?.headers?.find(x=>x.key==='Cache-Control')?.value!=='no-store')failures.push('Release identity must not be cached');
if(vercel.outputDirectory!=='dist/public')failures.push('Vercel must deploy dist/public');
for(const [source,destination]of [['/api/:path*','/api/:path*'],['/health/live','/health/live'],['/health/ready','/health/ready'],['/api/health/live','/health/live'],['/api/health/ready','/health/ready']]){
 if(vercel.rewrites?.find(x=>x.source===source)?.destination!==origin+destination)failures.push(`Incorrect Oracle proxy: ${source}`);
}
const headers=vercel.headers?.find(x=>x.source==='/:path*')?.headers??[];
if(!headers.find(x=>x.key==='Content-Security-Policy')?.value.includes("frame-ancestors 'none'"))failures.push('Vercel must prohibit framing through CSP');
requireText(dockerfile,/dotnet\/sdk:10\.0\.403-noble/,'Bundle must build using the qualified .NET 10 SDK');
requireText(dockerfile,/dotnet\/aspnet:10\.0\.14-noble AS runtime/,'Bundle must run the qualified .NET 10 runtime');
requireText(dockerfile,/org.opencontainers.image.revision=\$SOURCE_REVISION[\s\S]*io.smartfactory.backend.revision[\s\S]*io.smartfactory.edge.revision/,'Image must retain all source identities');
requireText(dockerfile,/^USER app$/m,'Bundle must run non-root');
requireText(dockerfile,/HEALTHCHECK[\s\S]*\/health\/live/,'Container health must use liveness during migrations');
for(const role of ['WEB','WORKER'])requireText(supervisor,new RegExp(`autostart=%\\(ENV_${role}_AUTOSTART\\)s`),`${role} processes must be role gated`);
const programs=[...supervisor.matchAll(/^\[program:([^\]]+)\]$/gm)].map(x=>x[1]).sort();
if(JSON.stringify(programs)!==JSON.stringify(['analytics','api','device','identity','notification','telemetry']))failures.push('Bundle must retain exactly six supervised processes');
requireText(entrypoint,/live = self\.path == '\/health\/live'[\s\S]*self\.send_response\(200 if live else 503\)/,'Migration listener must preserve liveness without false readiness');
requireText(entrypoint,/migrate_databases\(role\)/,'Migrations must precede service startup');
requireText(compose,/platform: linux\/arm64/,'Oracle runtime must remain ARM64');
requireText(compose,/RENDER_SERVICE_ROLE: web/,'Oracle API must use the API-only role');
requireText(compose,/RENDER_SERVICE_ROLE: worker/,'Oracle worker must use the singleton-worker role');
requireText(compose,/127\.0\.0\.1:10000:10000/,'API must remain loopback bound');
for(const phrase of ['singleton','API-first','immutable','rollback','/api/runtime/contract'])if(!guide.includes(phrase))failures.push(`Current runbook lacks ${phrase}`);
if(failures.length){failures.forEach(x=>console.error(x));process.exitCode=1;}else console.log('Oracle/Vercel topology, source identity and promotion compatibility checks passed.');
