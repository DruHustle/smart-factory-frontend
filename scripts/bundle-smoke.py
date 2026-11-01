#!/usr/bin/env python3
"""Acceptance checks for the real six-process image with disposable dependencies."""
from pathlib import Path
from http.cookiejar import CookieJar
from datetime import datetime, timezone
import json, os, re, secrets, subprocess, tempfile, time, urllib.request, urllib.error, urllib.parse, uuid

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

INDUSTRIAL_MQTT_PUBLISHER = '''
import json, socket, struct, sys
def field(value):
    value=value.encode(); return struct.pack('!H',len(value))+value
def receive(sock, size):
    result=b''
    while len(result)<size:
        part=sock.recv(size-len(result))
        if not part: raise RuntimeError('Fixture broker closed before acknowledgement')
        result+=part
    return result
def send(sock,kind,payload):
    size=len(payload); encoded=b''
    while True:
        byte=size%128; size//=128; encoded+=bytes([byte | (128 if size else 0)])
        if not size: break
    sock.sendall(bytes([kind])+encoded+payload)
payload=json.loads(sys.argv[1])
with socket.create_connection(('broker',1883),timeout=10) as sock:
    send(sock,0x10,field('MQTT')+bytes([4,0xc2])+struct.pack('!H',30)+field('bundle-industrial-publisher')+field('review')+field('isolated-review-broker'))
    assert receive(sock,4)==bytes([0x20,2,0,0])
    send(sock,0x32,field('factory/test/test/'+payload['deviceId']+'/telemetry')+struct.pack('!H',1)+json.dumps(payload,separators=(',',':'),allow_nan=False).encode())
    assert receive(sock,4)==bytes([0x40,2,0,1])
    send(sock,0xe0,b'')
'''

def prepare_industrial_rollback(opener):
    """Commission a synthetic gateway through the real dashboard/provisioner."""
    gateway_id='bundle-industrial-gateway'
    device=trpc(opener,'devices.create',{'deviceId':gateway_id,'name':'Disposable industrial rollback fixture','type':'gateway','route':'direct','freshnessSeconds':120})
    connection={'connectionId':'rollback-mqtt','name':'Synthetic rollback observations','protocol':'mqtt',
        'endpoint':'mqtt://127.0.0.1:1883','enabled':True,'intervalMs':1000,
        'mode':'simulated','scenarioRunId':'bundle-industrial-rollback',
        'tags':[
            {'tagId':'pressure','name':'Pressure','dataType':'float32','unit':'bar','source':{'topic':'fixture/pressure','path':'/value'}},
            {'tagId':'counter','name':'Exact counter','dataType':'uint64','source':{'topic':'fixture/counter','path':'/value'}},
            {'tagId':'missing','name':'Unavailable Boolean','dataType':'boolean','source':{'topic':'fixture/state','path':'/value'}},
        ]}
    saved=trpc(opener,'connectivity.save',{'gatewayDeviceId':gateway_id,'expectedRevision':0,'connections':[connection]})
    assert saved['saved'] is True and saved['revision']==1
    sent=trpc(opener,'connectivity.publish',{'gatewayDeviceId':gateway_id,'expectedRevision':1})
    assert sent['published'] is True and sent['revision']==1, 'Synthetic configuration did not traverse DeviceService to the broker.'
    return {'gatewayDeviceId':gateway_id,'devicePk':device['id'],'revision':1,'connectionId':'rollback-mqtt','reports':[]}

def publish_industrial_rollback(fixture):
    """Publish a new immutable observation through MQTT and the actual worker."""
    now=datetime.now(timezone.utc)
    observed_at=now.isoformat(timespec='milliseconds').replace('+00:00','Z')
    report={'schemaVersion':'industrial-observation/v1','connectionId':fixture['connectionId'],
        'configurationRevision':fixture['revision'],'eventId':str(uuid.uuid4()),'observedAt':observed_at,
        'state':'degraded','tags':[
            {'tagId':'pressure','dataType':'float32','value':12.5+len(fixture['reports']),'unit':'bar','quality':'good','qualityBasis':'payload'},
            {'tagId':'counter','dataType':'uint64','value':'18446744073709551615','quality':'uncertain','qualityBasis':'payload'},
            {'tagId':'missing','dataType':'boolean','value':None,'quality':'bad','qualityBasis':'payload','nativeStatus':'source_value_missing'},
        ]}
    payload={'deviceId':fixture['gatewayDeviceId'],'gatewayId':fixture['gatewayDeviceId'],'timestamp':int(now.timestamp()*1000),
        'integration':{'mode':'simulated','scenarioRunId':'bundle-industrial-rollback','sourceQuality':'unknown',
            'sourceConnection':'online','timestampOrigin':'gateway','gatewayReceivedAt':observed_at,'retained':False},
        'connectivity':report}
    run(COMPOSE+['exec','-T','bundle','python3','-c',INDUSTRIAL_MQTT_PUBLISHER,json.dumps(payload,separators=(',',':'))])
    event_id=report['eventId']
    wait(lambda:sql(f"SELECT count(*) FROM industrial_observation_history WHERE gateway_id={fixture['devicePk']} AND event_id='{event_id}'::uuid")=='1')
    fixture['reports'].append(report)

def verify_industrial_rollback(fixture, opener):
    """Compare raw durable envelopes and API history, including quality and precision."""
    assert sql(f"SELECT count(*) FROM industrial_observation_history WHERE gateway_id={fixture['devicePk']}")==str(len(fixture['reports']))
    for expected in fixture['reports']:
        event_id=expected['eventId']
        persisted=json.loads(sql(f"SELECT report::text FROM industrial_observation_history WHERE gateway_id={fixture['devicePk']} AND event_id='{event_id}'::uuid"))
        assert persisted==expected, 'An industrial envelope changed across the image transition.'
        worker_record=run(COMPOSE+['exec','-T','backend-database','psql','-U','postgres','-d','telemetry','-qAtc',
            f'''SELECT count(*) FROM "TelemetryRecords" WHERE "DeviceId"='{fixture['gatewayDeviceId']}' AND "ConnectivityJson"::jsonb->>'eventId'='{event_id}' AND "DashboardForwardedAt" IS NOT NULL AND "DeliveryQuarantinedAt" IS NULL'''],True).strip()
        # Dashboard commit precedes the worker's durable delivery receipt.
        if worker_record!='1':
            wait(lambda:run(COMPOSE+['exec','-T','backend-database','psql','-U','postgres','-d','telemetry','-qAtc',
                f'''SELECT count(*) FROM "TelemetryRecords" WHERE "DeviceId"='{fixture['gatewayDeviceId']}' AND "ConnectivityJson"::jsonb->>'eventId'='{event_id}' AND "DashboardForwardedAt" IS NOT NULL AND "DeliveryQuarantinedAt" IS NULL'''],True).strip()=='1')
    for tag in fixture['reports'][0]['tags']:
        history=trpc(opener,'connectivity.history',{'gatewayDeviceId':fixture['gatewayDeviceId'],'connectionId':fixture['connectionId'],'tagId':tag['tagId'],'limit':10},query=True)
        by_id={row['eventId']:row for row in history}
        for expected in fixture['reports']:
            actual=by_id[expected['eventId']]
            wanted=next(item for item in expected['tags'] if item['tagId']==tag['tagId'])
            assert actual['configurationRevision']==expected['configurationRevision']
            assert all(actual[key]==value for key,value in wanted.items())
            assert actual['currentEligible'] is False, 'Synthetic data became a current live measurement.'
    assert sql(f"SELECT count(*) FROM sensor_readings WHERE \"deviceId\"={fixture['devicePk']}")=='0', 'Industrial observations were flattened into legacy measurements.'

def credential_request(opener, procedure, value=None, query=False, expected=200):
    """Do not include request values or response bodies in credential failures."""
    path = '/api/trpc/' + procedure
    if query: path += '?input=' + urllib.parse.quote(json.dumps({'json': value}))
    try:
        status, data = http(opener, path, None if query else value)
    except Exception:
        raise AssertionError('Packaged account request failed: ' + procedure) from None
    if status != expected:
        raise AssertionError(f'Packaged account request {procedure} returned HTTP {status}; expected {expected}.')
    if expected != 200: return data
    try:
        return data['result']['data']['json']
    except (KeyError, TypeError):
        raise AssertionError('Packaged account response is invalid: ' + procedure) from None

def packaged_password_recovery(administrator, previous_session, user_id):
    """Real packaged API -> worker -> private SMTP -> emailed link -> identity.

    The account was registered and approved earlier in this same test. Run this
    only after the original notification and rollback assertions: enabling the
    synthetic sender and revoking this viewer's session must not affect them.
    """
    email = 'viewer@example.com'
    os.environ['BUNDLE_TEST_EMAIL_ENABLED'] = 'true'
    os.environ['BUNDLE_TEST_SMTP_PASSWORD'] = 'isolated-mail-capture-password'
    run(COMPOSE + ['up', '-d', '--wait', 'mail-capture'])
    run(COMPOSE + ['up', '-d', '--no-deps', 'bundle'])
    anonymous = urllib.request.build_opener()
    wait(lambda: http(anonymous, '/health/ready')[0] == 200)
    wait(lambda: run(COMPOSE + ['exec', '-T', 'bundle', 'supervisorctl', '-c', '/app/deploy/render/supervisord.conf', 'status'], True).count('RUNNING') == 6)
    wait(lambda: (http(anonymous, '/api/runtime/contract')[1].get('worker') or {}).get('compatible') is True)
    assert credential_request(anonymous, 'auth.passwordResetPolicy', query=True) == {'delivery': 'email'}
    assert credential_request(previous_session, 'auth.me', query=True)['id'] == user_id
    assert credential_request(anonymous, 'auth.requestPasswordReset', {'email': email}) == {'submitted': True}

    captured = None
    def reset_mail_arrived():
        nonlocal captured
        # This capture API has no host port. Its stdout is retained only in this
        # process's memory and is never written to logs or qualification evidence.
        try:
            messages = json.loads(run(COMPOSE + ['exec', '-T', 'mail-capture', 'python3', '-c',
                "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8025/messages',timeout=5).read().decode('utf-8'))"], True))
            matching = [message for message in messages if message.get('to') == [email]
                and message.get('subject') == 'Reset your Smart Factory password']
        except Exception:
            raise AssertionError('Private reset-email capture is unavailable.') from None
        if not matching: return False
        assert len(matching) == 1, 'Expected one synthetic reset email.'
        captured = matching[0]
        return True
    wait(reset_mail_arrived)
    assert captured is not None and isinstance(captured.get('text'), str), 'Reset email has no text body.'
    links = re.findall(r'https?://[^\s<>\"]+', captured['text'])
    assert len(links) == 1, 'Expected one reset link in the synthetic email.'
    reset_link = links[0]
    parsed = urllib.parse.urlsplit(reset_link)
    expected_origin = urllib.parse.urlsplit(BASE)
    assert (parsed.scheme, parsed.netloc, parsed.path, parsed.query) == (expected_origin.scheme, expected_origin.netloc, '/', ''), 'Reset email origin or document path is incorrect.'
    fragment_path, separator, fragment_query = parsed.fragment.partition('?')
    assert fragment_path == '/reset-password' and separator == '?', 'Reset email hash route is incorrect.'
    try:
        parameters = urllib.parse.parse_qs(fragment_query, strict_parsing=True)
    except ValueError:
        raise AssertionError('Reset email parameters are invalid.') from None
    assert set(parameters) == {'token'} and len(parameters['token']) == 1, 'Reset email must contain one token parameter.'
    token = parameters['token'][0]
    assert re.fullmatch(r'[A-Za-z0-9_-]{43}', token), 'Reset email token format is invalid.'
    assert reset_link == BASE + '/#/reset-password?token=' + token, 'Reset email URL is not canonical.'

    accepted_request = None
    def delivery_visible():
        nonlocal accepted_request
        queue = credential_request(administrator, 'users.pendingRequests', query=True)
        accepted_request = next((item for item in queue if item['email'] == email and item['kind'] == 'password_reset'), None)
        return accepted_request is not None and (accepted_request.get('recoveryDelivery') or {}).get('status') == 'accepted'
    wait(delivery_visible)
    assert accepted_request is not None
    assert set(accepted_request) <= {'id', 'kind', 'email', 'name', 'organization', 'jobTitle', 'createdAt', 'recoveryDelivery'}, 'Account request exposed an unexpected field.'
    delivery = accepted_request['recoveryDelivery']
    assert set(delivery) == {'status', 'failureCode', 'attempts', 'expiresAt'}, 'Delivery status exposed an unexpected field.'
    assert delivery['attempts'] >= 1 and delivery['failureCode'] is None
    assert token not in json.dumps(accepted_request) and reset_link not in json.dumps(accepted_request), 'Account request exposed a reset credential.'
    assert sql(f"SELECT count(*) FROM password_reset_tokens WHERE user_id={user_id} AND delivery_status='accepted' AND delivery_payload='' AND used_at IS NULL AND expires_at>now()") == '1'
    # Requesting a reset and accepting its email must not invalidate a session.
    assert credential_request(previous_session, 'auth.me', query=True)['id'] == user_id
    new_password = 'Bundle-recovered-' + secrets.token_urlsafe(24)
    assert credential_request(anonymous, 'auth.resetPassword', {'token': token, 'newPassword': new_password}) == {'reset': True}
    assert credential_request(previous_session, 'auth.me', query=True) is None
    credential_request(previous_session, 'assets.list', query=True, expected=401)
    credential_request(anonymous, 'auth.login', {'email': email, 'password': 'Bundle-test-Password-123!'}, expected=401)
    replay = credential_request(anonymous, 'auth.resetPassword', {'token': token, 'newPassword': new_password + 'x'}, expected=400)
    assert replay['error']['json']['data']['code'] == 'BAD_REQUEST'
    assert 'invalid' in replay['error']['json']['message'].lower()
    recovered = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
    signed_in = credential_request(recovered, 'auth.login', {'email': email, 'password': new_password})['user']
    assert signed_in['id'] == user_id and signed_in['passwordChangeRequired'] is False
    # In render-bundle mode auth.me delegates to the real C# IdentityService.
    profile = credential_request(recovered, 'auth.me', query=True)
    assert profile['id'] == user_id and profile['email'] == email and profile['role'] == 'viewer'
    credential_request(recovered, 'assets.list', query=True)
    assert sql(f"SELECT count(*) FROM password_reset_tokens WHERE user_id={user_id} AND delivery_status='accepted' AND delivery_payload='' AND used_at IS NOT NULL") == '1'
    pending_after = credential_request(administrator, 'users.pendingRequests', query=True)
    assert not any(item['email'] == email and item['kind'] == 'password_reset' for item in pending_after)
    print('PASS: packaged account recovery traverses the API, real SMTP worker and emailed link; old credentials are rejected and a new session reaches IdentityService.')
    return {'apiRequestQueued': True, 'workerSmtpAccepted': True, 'emailedLinkOriginAndRouteValidated': True,
        'administratorDeliveryStatusVerified': True, 'tokenRedeemed': True, 'previousPasswordRejected': True,
        'previousSessionRejected': True, 'tokenReplayRejected': True, 'newPasswordIdentityVerified': True,
        'productionAccountVerified': False, 'productionMailboxVerified': False}

completed = False
try:
    # The early restart/rollback checks intentionally exercise unconfigured mail.
    # Only the final isolated recovery stage may enable the private test sender.
    os.environ['BUNDLE_TEST_EMAIL_ENABLED'] = 'false'
    os.environ['BUNDLE_TEST_SMTP_PASSWORD'] = ''
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
    print('PASS: private first-admin bootstrap works and refuses a second bootstrap.')
    # Exercise the reviewed registration boundary with the disposable administrator.
    bootstrap_admin=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
    trpc(bootstrap_admin,'auth.login',{'email':'bootstrap@example.com','password':'Bootstrap-test-Password-123!'})
    status,_=http(plain,'/api/trpc/auth.register',{'email':'legacy@example.com','password':'Bundle-test-Password-123!','name':'Legacy'})
    assert status==403
    # Elevate only the isolated smoke identities after normal approval.
    accounts={}
    for role in ('engineer','viewer','admin'):
        email=role+'@example.com'
        trpc(plain,'auth.requestRegistration',{'email':email,'password':'Bundle-test-Password-123!','name':role.title()+' reviewer','organization':'Bundle smoke factory'})
        queue=trpc(bootstrap_admin,'users.pendingRequests',query=True)
        request=next(item for item in queue if item['email']==email and item['kind']=='registration')
        user=trpc(bootstrap_admin,'users.approveRegistration',{'id':request['id']})
        opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
        sql(f"UPDATE users SET role='{role}' WHERE id={user['id']}")
        trpc(opener,'auth.login',{'email':email,'password':'Bundle-test-Password-123!'})
        accounts[role]=(opener,user['id'])
        assert trpc(opener,'auth.me',query=True)['role'] == role
    admin,admin_id=accounts['admin']; engineer,engineer_id=accounts['engineer']; viewer,viewer_id=accounts['viewer']
    # Approval audits retain their reviewer. Disable this fixture identity through
    # the replacement administrator so evidence survives and recipients stay scoped.
    bootstrap_user=next(user for user in trpc(admin,'users.list',query=True) if user['email']=='bootstrap@example.com')
    trpc(admin,'users.setEnabled',{'id':bootstrap_user['id'],'enabled':False,'expectedVersion':bootstrap_user['accessVersion']})
    assert http(bootstrap_admin,'/api/trpc/assets.list')[0]==401
    assert sql(f"SELECT count(*) FROM security_audit WHERE action='account_registration_approved' AND actor_id={bootstrap_user['id']}")=='3'
    print('PASS: reviewed requests create individual accounts; disabling the bootstrap reviewer preserves approval evidence and revokes its session.')
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
    # Retained disabled reviewers are not active delivery recipients.
    wait(lambda: sql(f"SELECT count(*) FROM notification_inbox n JOIN users u ON u.id=n.\"userId\" WHERE n.\"alertId\"={alert} AND n.\"emailStatus\"='unconfigured' AND u.disabled_at IS NULL") == '4')
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
    named_factory=None
    if 'named-factories-v1' in runtime['capabilities']:
        draft={'document':{'name':'Qualified measured factory','width':30,'depth':20,'zones':[],'placements':[]},'dimensions':{},'tags':{}}
        factory=trpc(engineer,'factories.create',draft)
        created=trpc(engineer,'factories.add',{'id':factory['id'],'expectedVersion':factory['version'],'item':{'name':'Planned acceptance pump','identifier':'P-01','kind':'asset','itemType':'pump','dimensions':{'width':2,'depth':1,'height':1.5}}})
        factory=created['factory']; ref=created['ref']
        draft={key:factory[key] for key in ('document','dimensions','tags')}
        draft['document']['placements'][0]['x']=3
        saved=trpc(engineer,'factories.save',{'id':factory['id'],'expectedVersion':factory['version'],'draft':draft})
        assert saved['document']['placements'][0]['x']==3
        assert trpc(viewer,'inventory.list',{'factoryId':factory['id']},query=True)['total']==1
        assert http(viewer,'/api/trpc/factories.save',{'id':factory['id'],'expectedVersion':saved['version'],'draft':draft})[0]==403
        activity=trpc(viewer,'factories.activity.list',{'factoryId':factory['id']},query=True)['items']
        assert any(row['action']=='placement.changed' and row['actorId']==engineer_id for row in activity)
        deleted=trpc(admin,'factories.deleteItem',{'id':factory['id'],'expectedVersion':saved['version'],'ref':ref})
        assert deleted['items']==[] and trpc(viewer,'inventory.list',{'factoryId':factory['id']},query=True)['total']==0
        history=trpc(viewer,'factories.activity.list',{'factoryId':factory['id']},query=True)['items']
        assert any(row['action']=='inventory.deleted' and row['actorId']==admin_id for row in history)
        named_factory=factory['id']
        print('PASS: shared named factory, measured placement, canonical inventory deletion, roles and retained authenticated actor history work in the real image.')
    if 'infrastructure-monitor-v1' in runtime['capabilities']:
        def operating_snapshot():
            return trpc(admin,'system.infrastructure',{'range':'2h','scenario':'normal'},query=True)['snapshot']
        def worker_resources_ready():
            report=json.loads(sql("SELECT report FROM runtime_worker_status WHERE worker='telemetry'"))
            resource=report.get('resources') or {}
            return resource.get('residentBytes',0)>0 and resource.get('cpuMsPerSecond') is not None and resource.get('databaseQueryMs') is not None and report.get('notificationReady') is True
        wait(worker_resources_ready,timeout=100)
        snapshot=operating_snapshot()
        assert snapshot['synthetic'] is False
        assert next(r for r in snapshot['resources'] if r['id']=='worker-memory')['value']>0
        assert next(r for r in snapshot['resources'] if r['id']=='host-memory')['value'] is None
        assert next(s for s in snapshot['services'] if s['id']=='api')['state']=='healthy'
        # Exercise real disconnect/reconnect, allowing the documented 60-second cache.
        run(COMPOSE+['stop','broker'])
        wait(lambda:next(s for s in operating_snapshot()['services'] if s['id']=='mqtt')['state']=='unavailable',timeout=110)
        assert next(s for s in operating_snapshot()['services'] if s['id']=='api')['state']=='healthy'
        run(COMPOSE+['start','broker'])
        wait(lambda:next(s for s in operating_snapshot()['services'] if s['id']=='mqtt')['state']=='healthy',timeout=110)
        print('PASS: actual worker process resources and notification readiness are scoped; broker outage and reconnect remain independent of API liveness.')
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
        candidate_runtime=runtime
        rollback_sources=json.loads((ROOT/'deploy/rollback-sources.json').read_text())
        assert 'industrial-connectivity-v1' in candidate_runtime['capabilities']
        industrial_fixture=prepare_industrial_rollback(engineer)
        publish_industrial_rollback(industrial_fixture)
        verify_industrial_rollback(industrial_fixture,viewer)
        fallback_runtime=None
        user=next(u for u in trpc(admin,'users.list',query=True) if u['id']==engineer_id)
        trpc(admin,'users.setEnabled',{'id':engineer_id,'enabled':False,'expectedVersion':user['accessVersion']})
        assert http(engineer,'/api/trpc/assets.list')[0]==401
        for position,image_reference in enumerate([rollback_image,current_image]):
            os.environ['BUNDLE_IMAGE']=image_reference
            run(COMPOSE+['up','-d','--no-deps','bundle'])
            wait(lambda:http(plain,'/health/ready')[0]==200)
            wait(lambda:(http(plain,'/api/runtime/contract')[1].get('worker') or {}).get('compatible') is True)
            transition_runtime=http(plain,'/api/runtime/contract')[1]
            expected_sources=rollback_sources if position==0 else {'frontend':candidate_runtime['source'],'backend':candidate_runtime['backendSource'],'edge':candidate_runtime['edgeSource']}
            assert transition_runtime['source']==expected_sources['frontend']
            assert transition_runtime['backendSource']==expected_sources['backend'] and transition_runtime['edgeSource']==expected_sources['edge']
            assert transition_runtime['schema']['ready'] is True and transition_runtime['schema']['digest']==candidate_runtime['schema']['digest']
            assert transition_runtime['worker']['fresh'] is True and transition_runtime['worker']['compatible'] is True
            # The selected-model chooser is additive and is hidden on the qualified
            # fallback API. Every core workspace capability must remain available.
            required_capabilities = set(candidate_runtime['capabilities']) - {'assistant-provider-selection-v1'}
            assert required_capabilities.issubset(transition_runtime['capabilities'])
            if position==0: fallback_runtime=transition_runtime
            assert trpc(viewer,'auth.me',query=True)['id']==viewer_id
            assert http(engineer,'/api/trpc/assets.list')[0]==401
            assert sql('SELECT count(*) FROM sensor_readings WHERE "assetId" IS NULL')=='2'
            publish_industrial_rollback(industrial_fixture)
            verify_industrial_rollback(industrial_fixture,viewer)
        if named_factory:
            assert trpc(viewer,'factories.get',{'id':named_factory},query=True)['items']==[]
            assert any(row['action']=='inventory.deleted' for row in trpc(viewer,'factories.activity.list',{'factoryId':named_factory},query=True)['items'])
        runtime=http(plain,'/api/runtime/contract')[1]
        assert fallback_runtime is not None and len(industrial_fixture['reports'])==3
        rollback_evidence={'qualifiedPriorImage':rollback_image,'restoredCandidateImage':current_image,'revokedAccountStayedRejected':True,'activeViewerPreserved':True,'telemetryIdentitiesPreserved':True,'schemaCompatible':True,
            'runtime':fallback_runtime,'industrialObservationsPreserved':True,'industrialObservationCount':3,'industrialFallbackIngestionVerified':True}
        print('PASS: rollback and roll-forward preserve sessions, revocation, schema and all three industrial observations; the fallback also ingests new MQTT observations without dropping quality or exact 64-bit values.')
    # The explicit public-demo installer must not change private inventory or queue email.
    sql("INSERT INTO users(\"openId\",email,name,role) VALUES('demo-bundle-owner','admin@dev.local','Synthetic demo owner','admin')")
    private_before=sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(d) ORDER BY id)::text,'')) FROM devices d WHERE \"isDemo\"=false")
    # Freeze only this disposable notification worker to retain the exact queue baseline.
    run(COMPOSE+['exec','-T','bundle','supervisorctl','-c','/app/deploy/render/supervisord.conf','stop','notification'])
    queued_before=sql("SELECT count(*) FROM notification_inbox WHERE \"emailStatus\" IN('pending','processing','retrying')")
    installer=COMPOSE+['exec','-T','-e','PUBLIC_DEMO_DEPLOYMENT=true','-e','SHOWCASE_INSTALL_APPROVED=read-only-showcase-v4','bundle','node','scripts/showcase/install.mjs']
    plan=json.loads(run(installer+['--plan'],True).splitlines()[-1]);assert plan['version']==4 and not plan['emailRequests']
    for _ in range(2):
        installed=json.loads(run(installer+['--apply'],True).splitlines()[-1]);assert installed['chapters']==15 and installed['externalDeliveryRequests']==0
    claim=sql("SELECT value::text FROM system_settings WHERE key='showcase_install_v4'")
    sql("UPDATE system_settings SET value=jsonb_set(value::jsonb,'{state}','\"installing\"') WHERE key='showcase_install_v4'")
    refused=subprocess.run(installer+['--apply'],cwd=ROOT,capture_output=True,text=True);assert refused.returncode!=0
    sql("UPDATE system_settings SET value="+"'"+claim.replace("'","''")+"'::jsonb WHERE key='showcase_install_v4'")
    assert sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(d) ORDER BY id)::text,'')) FROM devices d WHERE \"isDemo\"=false")==private_before
    assert sql("SELECT count(*) FROM notification_inbox WHERE \"emailStatus\" IN('pending','processing','retrying')")==queued_before
    assert trpc(admin,'system.demoData',query=True)['enabled'] is False
    assert sql("SELECT count(*) FROM devices WHERE \"deviceId\" LIKE 'showcase.%' AND \"lastSeen\" IS NOT NULL")=='0'
    assert sql("SELECT count(*) FROM notification_inbox n JOIN alerts a ON a.id=n.\"alertId\" JOIN devices d ON d.id=a.\"deviceId\" WHERE d.\"isDemo\"=true AND n.\"emailStatus\"<>'demo_only'")=='0'
    assert sql("SELECT count(*) FROM notification_inbox WHERE kind IN('showcase_process','showcase_security') AND \"emailStatus\"='demo_only'")=='2'
    assert sql("SELECT count(*) FROM notification_inbox WHERE kind IN('showcase_process','showcase_security') AND (\"emailStatus\"<>'demo_only' OR \"acceptedAt\" IS NOT NULL OR attempts<>0)")=='0'
    run(COMPOSE+['exec','-T','bundle','supervisorctl','-c','/app/deploy/render/supervisord.conf','start','notification'])
    wait(lambda: run(COMPOSE+['exec','-T','bundle','supervisorctl','-c','/app/deploy/render/supervisord.conf','status'], True).count('RUNNING') == 6)
    print('PASS: packaged demo installer is explicit and idempotent, preserves operational inventory and global visibility, and requests no email or current connectivity.')
    password_recovery_evidence = packaged_password_recovery(admin, viewer, viewer_id)
    final_runtime = http(plain, '/api/runtime/contract')[1]
    assert all(final_runtime[key] == runtime[key] for key in ['source', 'backendSource', 'edgeSource'])
    assert final_runtime['schema']['ready'] is True and final_runtime['worker']['fresh'] is True and final_runtime['worker']['compatible'] is True
    runtime = final_runtime
    image=json.loads(run(['docker','image','inspect',os.environ.get('BUNDLE_IMAGE','smart-factory-render-review:local')],True))[0]
    output=Path(os.environ.get('QUALIFICATION_EVIDENCE_DIR',str(Path(tempfile.gettempdir())/'factory-arm64-bundle-evidence')));output.mkdir(parents=True,exist_ok=True)
    (output/'result.json').write_text(json.dumps({'completedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'runtime':runtime,'compatibleRollback':rollback_evidence,'image':{'id':image['Id'],'platform':image['Os']+'/'+image['Architecture'],'labels':image['Config']['Labels']},'sixServicesNonRoot':True,'migrationsIdempotent':True,'bootstrapBoundary':True,'individualAuthorization':True,'nativeSecurityOutbox':True,'notificationOwnershipAndRestart':True,'coverageUnitsAndScope':True,'mqttQos0AndQos1':True,'standaloneSensorTraversal':True,'dependencyFailureRecovery':True,'packagedPasswordRecovery':password_recovery_evidence,'physicalEquipment':False,'productionPromotion':False},indent=2)+'\n')
    completed = True
finally:
    try:
        if not completed:
            logfile = Path(os.environ.get('TMPDIR', '/tmp')) / 'smart-factory-bundle-smoke.log'
            logfile.write_text(run(COMPOSE+['logs','--no-color'], True))
            print('Synthetic acceptance-test failure log: ' + str(logfile))
    finally: run(COMPOSE+['--profile','mail-capture','down','--volumes','--remove-orphans'])
