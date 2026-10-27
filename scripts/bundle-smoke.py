#!/usr/bin/env python3
"""Acceptance checks for the real six-process image with disposable dependencies."""
from pathlib import Path
from http.cookiejar import CookieJar
import json, os, subprocess, tempfile, time, urllib.request, urllib.error, urllib.parse

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ['docker', 'compose', '--env-file', '/dev/null', '-p', 'smart-factory-bundle-test', '-f', str(ROOT / 'docker-compose.bundle-test.yml')]
BASE = 'http://127.0.0.1:3110'
def run(args, capture=False):
    return subprocess.run(args, cwd=ROOT, check=True, text=True, stdout=subprocess.PIPE if capture else None).stdout
def sql(value):
    return run(COMPOSE + ['exec', '-T', 'database', 'psql', '-U', 'postgres', '-d', 'dashboard', '-qAtc', value], True).strip()
def http(opener, path, value=None):
    request = urllib.request.Request(BASE + path, data=json.dumps({'json': value}).encode() if value is not None else None,
        headers={'Content-Type': 'application/json'})
    try: response = opener.open(request, timeout=25)
    except urllib.error.HTTPError as error: response = error
    raw = response.read()
    if not raw:
        return response.status, None
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        # During container startup an upstream proxy or a process that has not
        # reached readiness can return a short plain-text/HTML response. Preserve
        # it for diagnostics and let wait() retry instead of crashing the suite.
        payload = raw.decode('utf-8', errors='replace')[:4096]
    return response.status, payload
def trpc(opener, procedure, value=None, query=False):
    path = '/api/trpc/' + procedure
    if query: path += '?input=' + urllib.parse.quote(json.dumps({'json': value}))
    status, data = http(opener, path, None if query else value)
    if status != 200: raise AssertionError(f'{procedure}: {status}: {data}')
    return data['result']['data']['json']
def wait(check, timeout=90):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        try:
            if check(): return
        except (OSError, AssertionError): pass
        time.sleep(1)
    raise AssertionError('Acceptance condition timed out')

completed = False
try:
    run(COMPOSE + ['up','-d','--wait','database','backend-database','redis','broker'])
    # Repeated pre-deploy tasks must be idempotent and need no mounted disk.
    for _ in range(2): run(COMPOSE + ['run','--rm','--entrypoint','python3','bundle','/app/deploy/render/migrate.py'])
    run(COMPOSE + ['up','-d','bundle'])
    plain = urllib.request.build_opener()
    wait(lambda: http(plain, '/health/ready')[0] == 200)
    wait(lambda: run(COMPOSE+['exec','-T','bundle','supervisorctl','-c','/app/deploy/render/supervisord.conf','status'], True).count('RUNNING') == 6)
    assert run(COMPOSE+['exec','-T','bundle','id','-u'], True).strip() != '0'
    print('PASS: migrations repeat safely; all six services are running as a non-root user.')
    bootstrap = COMPOSE + ['exec','-T','-e','BOOTSTRAP_ADMIN_EMAIL=bootstrap@example.com',
        '-e','BOOTSTRAP_ADMIN_PASSWORD=Bootstrap-test-Password-123!',
        'bundle','node','scripts/bootstrap-admin.mjs']
    run(bootstrap)
    refused = subprocess.run(bootstrap, cwd=ROOT, capture_output=True, text=True)
    assert refused.returncode != 0 and 'administrator already exists' in refused.stderr
    sql("DELETE FROM users WHERE email='bootstrap@example.com'")
    print('PASS: private first-admin bootstrap works and refuses a second bootstrap.')
    # Seed isolated accounts via the real API and elevate test roles in the disposable DB.
    accounts={}
    for role in ('engineer','viewer','admin'):
        opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
        user=trpc(opener,'auth.register',{'email':role+'@example.com','password':'Bundle-test-Password-123!','name':role})['user']
        sql(f"UPDATE users SET role='{role}' WHERE id={user['id']}")
        accounts[role]=(opener,user['id'])
        assert trpc(opener,'auth.me',query=True)['role'] == role
    admin,admin_id=accounts['admin']; engineer,engineer_id=accounts['engineer']; viewer,viewer_id=accounts['viewer']
    assert trpc(viewer,'system.demoData',query=True)['enabled'] is False
    status,_=http(viewer,'/api/trpc/system.setDemoData',{'enabled':True}); assert status==403
    sql("INSERT INTO assets(\"assetId\",name,\"assetType\",\"aasShell\",\"isDemo\") VALUES('urn:bundle:demo','Explicit bundle simulation','motor','{}'::json,true)")
    count_before=sql('SELECT count(*) FROM assets')
    assert trpc(admin,'system.setDemoData',{'enabled':True})['enabled'] is True
    assert sql('SELECT count(*) FROM assets')==count_before
    assert any(asset['isDemo'] for asset in trpc(viewer,'assets.list',query=True))
    assert trpc(admin,'system.setDemoData',{'enabled':False})['enabled'] is False
    assert not any(asset['isDemo'] for asset in trpc(viewer,'assets.list',query=True))
    print('PASS: the persisted demo-data switch is admin-only and immediately controls API visibility.')
    # Check the private service boundary, independent of the public Node role guard.
    status=run(COMPOSE+['exec','-T','bundle','curl','-s','-o','/dev/null','-w','%{http_code}','http://127.0.0.1:3104/api/auth/profile'], True)
    assert status == '401'
    wait(lambda: int(sql("SELECT count(*) FROM security_events e JOIN security_sources s ON s.id=e.source_id WHERE s.system_key='dotnet-services' AND e.event_type='auth.authentication_failed'")) >= 1)
    assert sql("SELECT count(*) FROM security_events e JOIN security_sources s ON s.id=e.source_id WHERE s.system_key='dotnet-services' AND e.envelope->'attributes'->>'service'='identity-service'") != '0'
    print('PASS: IdentityService rejects the actual anonymous request and its own durable outbox reaches the native security workspace.')
    device=trpc(engineer,'devices.create',{'deviceId':'bundle-gateway','name':'Bundle gateway','type':'gateway'})
    alert=int(sql(f'''INSERT INTO alerts ("deviceId",type,severity,message,"errorCode") VALUES ({device['id']},'system_error','critical','Bundle incident','SF-TEST') RETURNING id'''))
    trpc(engineer,'alerts.assign',{'id':alert,'assignedToId':engineer_id})
    items=trpc(engineer,'notifications.list',query=True)
    assert len([item for item in items if item['alertId']==alert]) == 2
    assert not trpc(viewer,'notifications.list',query=True)
    status,_=http(viewer,'/api/trpc/notifications.markRead',{'id':items[0]['id']}); assert status==404
    trpc(engineer,'notifications.markRead',{'id':items[0]['id']})
    wait(lambda: sql(f"SELECT count(*) FROM notification_inbox WHERE \"alertId\"={alert} AND \"emailStatus\"='unconfigured'") == '4')
    assert sql("SELECT count(*) FROM notification_inbox WHERE kind='account_welcome' AND \"emailStatus\"='unconfigured'") == '3'
    run(COMPOSE+['exec','-T','bundle','supervisorctl','-c','/app/deploy/render/supervisord.conf','restart','notification'])
    assert len(trpc(engineer,'notifications.list',query=True)) == 2
    print('PASS: incidents and account creation queue distinct durable email; inbox ownership is enforced; unconfigured delivery is explicit after restart.')
    sql("INSERT INTO assets(\"assetId\",name,\"assetType\",\"aasShell\") VALUES('urn:bundle:motor','Synthetic bundle motor','motor','{}'::json)")
    for stamp, temperature, power in [(1000,10,None),(2000,None,80),(5000,30,100)]:
        measurements={metric:{'canonicalUnit':unit,'conversionVersion':'sf-units-v1','quality':'good','canonicalValue':value} for metric,unit,value in [('temperature','°C',temperature),('power','W',power)] if value is not None}
        sql(f"INSERT INTO sensor_readings (\"deviceId\",\"assetId\",temperature,power,timestamp,integration,measurements) VALUES ({device['id']},'urn:bundle:motor',{temperature if temperature is not None else 'NULL'},{power if power is not None else 'NULL'},{stamp},'{{\"mode\":\"live\"}}'::jsonb,'{json.dumps(measurements)}'::jsonb)")
    coverage=trpc(engineer,'analytics.getCoverage',{'assetIds':['urn:bundle:motor'],'startTime':1,'endTime':6000,'intervalMs':60000,'scope':'live'},query=True)['assets'][0]
    assert coverage['samples']==3 and coverage['longestGapMs']==3000
    assert coverage['metrics'][0]['samples']==2 and coverage['metrics'][0]['average']==20
    assert coverage['metrics'][1]['samples']==0 and coverage['metrics'][1]['average'] is None
    print('PASS: AnalyticsService calculates stored sample coverage, gaps and null-safe aggregates.')
    # A QoS 1 subscription also receives QoS 0 publications. QoS 0 has no
    # packet identifier, so manually acknowledging it would disconnect MQTTnet.
    direct_devices = [trpc(engineer,'devices.create',{'deviceId':f'bundle-qos{qos}','name':f'Bundle direct sensor {qos}','type':'sensor','route':'direct','freshnessSeconds':120}) for qos in [0,1]]
    publisher = '''
import json, socket, struct, time
def field(value):
    value=value.encode(); return struct.pack('!H',len(value))+value
def send(sock,kind,payload):
    size=len(payload); encoded=b''
    while True:
        byte=size%128; size//=128; encoded+=bytes([byte | (128 if size else 0)])
        if not size: break
    sock.sendall(bytes([kind])+encoded+payload)
with socket.create_connection(('broker',1883),timeout=10) as sock:
    send(sock,0x10,field('MQTT')+bytes([4,0xc2])+struct.pack('!H',30)+field('bundle-qos-publisher')+field('review')+field('isolated-review-broker'))
    assert sock.recv(4)==bytes([0x20,2,0,0])
    for qos in [0,1]:
        message=json.dumps({'deviceId':'bundle-qos'+str(qos),'timestamp':int(time.time()*1000),'temperature':42,'units':{'temperature':'°C'},'integration':{'mode':'live','sourceQuality':'good','sourceConnection':'online','gatewayReceivedAt':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()}}).encode()
        send(sock,0x30 | (qos << 1),field('factory/test/test/bundle-qos'+str(qos)+'/telemetry')+(struct.pack('!H',1) if qos else b'')+message)
        if qos: assert sock.recv(4)==bytes([0x40,2,0,1])
    send(sock,0xe0,b'')
'''
    wait(lambda: 'Connected to MQTT' in run(COMPOSE+['logs','bundle'], True))
    connections_before=run(COMPOSE+['logs','bundle'], True).count('Connected to MQTT')
    run(COMPOSE+['exec','-T','bundle','python3','-c',publisher])
    def mqtt_records_saved():
        count=run(COMPOSE+['exec','-T','backend-database','psql','-U','postgres','-d','telemetry','-qAtc',
            '''SELECT count(DISTINCT "DeviceId") FROM "TelemetryRecords" WHERE "DeviceId" IN ('bundle-qos0','bundle-qos1')'''], True)
        return count.strip()=='2'
    wait(mqtt_records_saved)
    time.sleep(1)  # Allow asynchronous acknowledgement logging/reconnects to complete.
    mqtt_logs=run(COMPOSE+['logs','bundle'], True)
    assert 'PubAck packet has no packet identifier' not in mqtt_logs
    assert mqtt_logs.count('Connected to MQTT') == connections_before
    print('PASS: QoS 0 and QoS 1 MQTT messages persist without invalid acknowledgements or reconnects.')
    wait(lambda: sql('''SELECT count(DISTINCT r."deviceId") FROM sensor_readings r JOIN devices d ON d.id=r."deviceId" WHERE d."deviceId" IN ('bundle-qos0','bundle-qos1') AND r."assetId" IS NULL''')=='2')
    for direct in direct_devices:
        item=trpc(engineer,'inventory.item',{'ref':f"device:{direct['id']}"},query=True)
        assert item['route']=='Direct MQTT' and item['status']=='live' and not item['aas'] and item['sampleAt'] is not None
        assert trpc(engineer,'assets.getAllForDevice',{'devicePk':direct['id']},query=True)==[]
    print('PASS: registered standalone sensors traverse real MQTT, .NET durable forwarding and Node inventory without an AAS or gateway.')
    wait(lambda: (http(plain,'/api/runtime/contract')[1].get('worker') or {}).get('compatible') is True)
    runtime=http(plain,'/api/runtime/contract')[1]
    assert runtime['schema']['ready'] is True
    assert all(isinstance(runtime[key],str) and len(runtime[key])==40 for key in ['source','backendSource','edgeSource'])
    assert runtime['worker']['fresh'] is True
    print('PASS: runtime identity, applied schema and fresh compatible singleton worker match the image sources.')
    run(COMPOSE+['stop','database'])
    wait(lambda: http(plain,'/health/ready')[0]==503, timeout=30)
    assert http(plain,'/health/live')[0]==200
    run(COMPOSE+['start','database'])
    wait(lambda: http(plain,'/health/ready')[0]==200)
    run(COMPOSE+['exec','-T','bundle','supervisorctl','-c','/app/deploy/render/supervisord.conf','stop','analytics'])
    assert http(plain,'/health/ready')[0]==503
    run(COMPOSE+['exec','-T','bundle','supervisorctl','-c','/app/deploy/render/supervisord.conf','start','analytics'])
    wait(lambda: http(plain,'/health/ready')[0]==200)
    print('PASS: database/service failures produce readiness 503 while liveness stays available, and recover.')
    rollback_evidence=None
    rollback_image=os.environ.get('BUNDLE_ROLLBACK_IMAGE')
    if rollback_image:
        current_image=os.environ.get('BUNDLE_IMAGE','smart-factory-render-review:local')
        user=next(u for u in trpc(admin,'users.list',query=True) if u['id']==engineer_id)
        trpc(admin,'users.setEnabled',{'id':engineer_id,'enabled':False,'expectedVersion':user['accessVersion']})
        assert http(engineer,'/api/trpc/assets.list')[0]==401
        for image_reference in [rollback_image,current_image]:
            os.environ['BUNDLE_IMAGE']=image_reference
            run(COMPOSE+['up','-d','--no-deps','bundle'])
            wait(lambda:http(plain,'/health/ready')[0]==200)
            wait(lambda:(http(plain,'/api/runtime/contract')[1].get('worker') or {}).get('compatible') is True)
            assert trpc(viewer,'auth.me',query=True)['id']==viewer_id
            assert http(engineer,'/api/trpc/assets.list')[0]==401
            assert sql('SELECT count(*) FROM sensor_readings WHERE "assetId" IS NULL')=='2'
        runtime=http(plain,'/api/runtime/contract')[1]
        rollback_evidence={'qualifiedPriorImage':rollback_image,'restoredCandidateImage':current_image,'revokedAccountStayedRejected':True,'activeViewerPreserved':True,'telemetryIdentitiesPreserved':True,'schemaCompatible':True}
        print('PASS: rollback and roll-forward to a compatible hardened image preserve sessions, revocation, schema and telemetry identities.')
    # The explicit public-demo installer must not change private inventory or queue email.
    sql("INSERT INTO users(\"openId\",email,name,role) VALUES('demo-bundle-owner','admin@dev.local','Synthetic demo owner','admin')")
    private_before=sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(d) ORDER BY id)::text,'')) FROM devices d WHERE \"isDemo\"=false")
    queued_before=sql("SELECT count(*) FROM notification_inbox WHERE \"emailStatus\" IN('pending','processing','retrying')")
    installer=COMPOSE+['exec','-T','-e','PUBLIC_DEMO_DEPLOYMENT=true','-e','SHOWCASE_INSTALL_APPROVED=read-only-showcase-v2','bundle','node','scripts/showcase/install.mjs']
    plan=json.loads(run(installer+['--plan'],True).splitlines()[-1]);assert plan['version']==2 and not plan['emailRequests']
    for _ in range(2):
        installed=json.loads(run(installer+['--apply'],True).splitlines()[-1]);assert installed['chapters']==12 and installed['externalDeliveryRequests']==0
    assert sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(d) ORDER BY id)::text,'')) FROM devices d WHERE \"isDemo\"=false")==private_before
    assert sql("SELECT count(*) FROM notification_inbox WHERE \"emailStatus\" IN('pending','processing','retrying')")==queued_before
    assert trpc(admin,'system.demoData',query=True)['enabled'] is False
    assert sql("SELECT count(*) FROM devices WHERE \"deviceId\" LIKE 'showcase.%' AND \"lastSeen\" IS NOT NULL")=='0'
    print('PASS: packaged demo installer is explicit and idempotent, preserves operational inventory and global visibility, and requests no email or current connectivity.')
    image=json.loads(run(['docker','image','inspect',os.environ.get('BUNDLE_IMAGE','smart-factory-render-review:local')],True))[0]
    output=Path(os.environ.get('QUALIFICATION_EVIDENCE_DIR',str(Path(tempfile.gettempdir())/'factory-arm64-bundle-evidence')));output.mkdir(parents=True,exist_ok=True)
    (output/'result.json').write_text(json.dumps({'completedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'runtime':runtime,'compatibleRollback':rollback_evidence,'image':{'id':image['Id'],'platform':image['Os']+'/'+image['Architecture'],'labels':image['Config']['Labels']},'sixServicesNonRoot':True,'migrationsIdempotent':True,'bootstrapBoundary':True,'individualAuthorization':True,'nativeSecurityOutbox':True,'notificationOwnershipAndRestart':True,'coverageUnitsAndScope':True,'mqttQos0AndQos1':True,'standaloneSensorTraversal':True,'dependencyFailureRecovery':True,'physicalEquipment':False,'productionPromotion':False},indent=2)+'\n')
    completed = True
finally:
    try:
        if not completed:
            logfile = Path(os.environ.get('TMPDIR', '/tmp')) / 'smart-factory-bundle-smoke.log'
            logfile.write_text(run(COMPOSE+['logs','--no-color'], True))
            print('Synthetic acceptance-test failure log: ' + str(logfile))
    finally: run(COMPOSE+['down','--volumes','--remove-orphans'])
