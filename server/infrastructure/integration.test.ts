import {beforeAll,afterAll,afterEach,describe,it,expect,vi} from 'vitest';
import {createServer,type Server} from 'node:http';
import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {disposableDatabase} from '../test/disposableDatabase';
import {getDb,createUser,getUserByEmail} from '../db';
import * as collector from './collector';
import {infrastructureView,storeRecoveryEvidence} from './store';
import {storeWorkerReceipt} from '../operatingEvidence';
import {notificationPage} from '../notifications';
import {appRouter} from '../routers';
import type {TrpcContext} from '../_core/context';
describe.skipIf(!process.env.TEST_DATABASE_URL)('disposable infrastructure operating evidence',()=>{
 disposableDatabase('infrastructure');afterEach(()=>vi.useRealTimers());let server:Server,origin:string,status=503;
 beforeAll(async()=>{
  vi.stubEnv('ALLOWED_ORIGIN','');vi.stubEnv('AAS_REPOSITORY_URL','');vi.stubEnv('REDIS_URL','');vi.stubEnv('MqttBrokerHost','');vi.stubEnv('INFRASTRUCTURE_EMAIL_ENABLED','false');
  server=createServer((_,res)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({source:'a'.repeat(40),requiredCapabilities:[]}));});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;vi.stubEnv('INFRASTRUCTURE_FRONTEND_ORIGIN',origin);
  for(const role of ['admin','viewer'] as const)await createUser({openId:randomUUID(),email:`infra-${role}@example.test`,name:`Infrastructure ${role}`,role});
 });
 afterAll(async()=>{vi.useRealTimers();await new Promise<void>(resolve=>server?.close(()=>resolve()));});
 const caller=async(role:'admin'|'viewer',cookie='smart_factory_data_workspace=live')=>appRouter.createCaller({user:await getUserByEmail(`infra-${role}@example.test`),req:{headers:{cookie}},res:{}} as unknown as TrpcContext);
 it('retains partial checks, scopes resources, rejects non-admin access and isolates the demo',async()=>{
  const data=await infrastructureView();expect(data.snapshot.synthetic).toBe(false);expect(data.snapshot.services.find(s=>s.id==='frontend')?.state).toBe('unavailable');expect(data.snapshot.services.find(s=>s.id==='api')?.state).toBe('healthy');expect(data.snapshot.services.find(s=>s.id==='database')?.state).toBe('healthy');expect(data.snapshot.services.find(s=>s.id==='aas-repository')?.state).toBe('not_configured');expect(data.snapshot.resources.find(r=>r.id==='api-rss')!.value).toBeGreaterThan(0);expect(data.snapshot.resources.find(r=>r.id==='host-memory')?.value).toBeNull();expect(data.snapshot.recovery).toEqual([]);expect(data.history.length).toBe(1);
  await expect((await caller('viewer')).system.infrastructure({range:'2h',scenario:'normal'})).rejects.toMatchObject({code:'FORBIDDEN'});
  const spy=vi.spyOn(collector,'collectInfrastructure');const demo=await(await caller('admin','smart_factory_data_workspace=demo')).system.infrastructure({range:'2h',scenario:'failure'});expect(demo.snapshot.synthetic).toBe(true);expect(spy).not.toHaveBeenCalled();expect(JSON.stringify(demo)).not.toContain(origin);spy.mockRestore();
  const again=await infrastructureView();expect(again.snapshot.collectedAt).toBe(data.snapshot.collectedAt);const [count]=await(await getDb())!.execute(sql`select count(*)::int as n from infrastructure_snapshots`);expect(count.n).toBe(1);
 });
 it('sustains and deduplicates an infrastructure inbox incident, then records recovery without email',async()=>{
  const now=Date.now();vi.useFakeTimers({toFake:['Date']});
  for(const seconds of [61,122]){vi.setSystemTime(now+seconds*1000);await infrastructureView();}
  const admin=(await getUserByEmail('infra-admin@example.test'))!,inbox=await notificationPage(admin.id);expect(inbox.items.filter(n=>n.kind==='infrastructure')).toHaveLength(1);expect(inbox.items[0].infrastructureEventId).toBeTruthy();expect(inbox.items[0].emailStatus).toBe('inbox_only');
  vi.setSystemTime(now+183000);await infrastructureView();expect((await notificationPage(admin.id)).items.filter(n=>n.kind==='infrastructure')).toHaveLength(1);
  status=200;for(const seconds of [244,305]){vi.setSystemTime(now+seconds*1000);await infrastructureView();}
  const recovered=await notificationPage(admin.id);expect(recovered.items.filter(n=>n.kind==='infrastructure')).toHaveLength(2);expect(recovered.items.some(n=>n.title.includes('recovered'))).toBe(true);expect(recovered.items.every(n=>n.emailStatus==='inbox_only')).toBe(true);const viewer=(await getUserByEmail('infra-viewer@example.test'))!;expect((await notificationPage(viewer.id)).items).toEqual([]);vi.useRealTimers();
 });
 it('preserves stale worker counts and uses acceptance time rather than old security occurrence',async()=>{
  const now=Date.now();vi.stubEnv('MqttBrokerHost','localhost');await storeWorkerReceipt({worker:'telemetry',source:'b'.repeat(40),runtime:'10.0.14',contractVersion:2,migrationsDigest:'c'.repeat(64),mqttSubscribed:false,observedAt:new Date(now-10000).toISOString(),pending:7,quarantined:2,failedAttempts:3,oldestPendingAt:new Date(now-800000).toISOString(),resources:{residentBytes:20000000,cpuMsPerSecond:18,databaseQueryMs:4},notificationReady:false});
  await(await getDb())!.execute(sql`update runtime_worker_status set received_at=now()-interval '3 minutes',report=jsonb_set(report,'{observedAt}',${JSON.stringify(new Date(now-180000).toISOString())}::jsonb)`);
  await(await getDb())!.execute(sql`insert into security_outbox(id,producer,event_type,attributes,occurred_at,accepted_at) values(${randomUUID()},'fixture','fixture.event','{}'::jsonb,now()-interval '30 days',now()-interval '10 seconds')`);
  const data=await collector.collectInfrastructure(),q=data.queues.find(q=>q.id==='telemetry')!,security=data.queues.find(q=>q.id==='security')!;expect(q.state).toBe('stale');expect(q.pending).toBe(7);expect(q.quarantined).toBe(2);expect(data.services.find(s=>s.id==='api')?.state).toBe('healthy');expect(security.oldestAgeSeconds).toBeLessThan(30);expect(data.services.find(s=>s.id==='mqtt')?.state).toBe('stale');
 });
 it('keeps immutable backup and restore attestations distinct and rejects conflicting reuse',async()=>{
  const backup={kind:'backup',receiptId:'disposable-backup-proof',observedAt:new Date().toISOString(),outcome:'verified',source:'operator-verifier',scope:'application-databases',artifactSha256:'a'.repeat(64),sourceRevision:null} as const;
  await storeRecoveryEvidence(backup);await storeRecoveryEvidence(backup);await expect(storeRecoveryEvidence({...backup,artifactSha256:'b'.repeat(64)})).rejects.toThrow();await expect(storeRecoveryEvidence({...backup,kind:'restore',receiptId:'invalid-restore'})).rejects.toThrow();
  const data=await collector.collectInfrastructure();expect(data.recovery).toHaveLength(1);expect(data.recovery[0].kind).toBe('backup');expect(data.recovery.some(r=>r.kind==='restore')).toBe(false);
 });
});
