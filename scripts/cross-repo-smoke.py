#!/usr/bin/env python3
"""Exercise real local Node/.NET/MQTT/Pi paths with a simulated serial controller.

Requires sibling repositories, pnpm, Docker and Python edge dependencies. Start
its own disposable BaSyx repositories. Test data uses unique AAS IDs and is
cleaned up; databases, Redis and MQTT are disposable and loopback-only.
"""
from __future__ import annotations
from http.cookiejar import CookieJar
import importlib.util
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import tempfile
import time
import types
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
EDGE_ROOT = ROOT.parent / 'smart-factory-iot-edge' / 'raspberry-pi'
EDGE = EDGE_ROOT / 'src'

# Use the edge repository's pinned virtual environment when the caller did not
# activate it. This keeps the smoke command reproducible without installing
# gateway dependencies into the developer's global Python.
if importlib.util.find_spec('paho') is None:
    edge_python = EDGE_ROOT / '.venv' / 'bin' / 'python'
    if edge_python.is_file() and Path(sys.executable).resolve() != edge_python.resolve():
        os.execv(str(edge_python), [str(edge_python), str(Path(__file__).resolve()), *sys.argv[1:]])
    raise SystemExit('Edge Python dependencies are missing; create raspberry-pi/.venv and install raspberry-pi/requirements.txt')

sys.path.insert(0, str(EDGE))
import paho.mqtt.client as mqtt
from sensor_gateway import make_mqtt_client, command_topic, forward_local_message, gateway_observation
from asset_adapters import load_asset_connections, save_asset_profile
from ada031_control import Ada031SerialCommandManager, validate_command
from durable_state import DurableState, DurablePublisher

COMPOSE = ['docker', 'compose', '--env-file', '/dev/null', '-p', 'smart-factory-review', '-f', str(ROOT / 'docker-compose.integration.yml'), '-f', str(ROOT / 'scripts/qualification/compose.aas.yaml')]
BASE = 'http://127.0.0.1:3101'
TOKEN = 'isolated-review-provisioner-at-least-32-bytes'

def run(args, **kwargs):
    subprocess.run(args, cwd=ROOT, check=True, **kwargs)

def http(opener, path, value=None, method=None, headers=None):
    body = json.dumps(value).encode() if value is not None else None
    request = urllib.request.Request(path if path.startswith('http') else BASE + path, data=body,
        method=method or ('POST' if body is not None else 'GET'), headers={'Content-Type': 'application/json', **(headers or {})})
    try: response = opener.open(request, timeout=20)
    except urllib.error.HTTPError as error: response = error
    data = response.read()
    return response.status, json.loads(data) if data else None

def trpc(opener, procedure, value=None, query=False):
    path = '/api/trpc/' + procedure
    if query:
        path += '?input=' + urllib.parse.quote(json.dumps({'json': value}))
        status, result = http(opener, path)
    else:
        status, result = http(opener, path, {'json': value})
    if status != 200: raise AssertionError(f'{procedure}: HTTP {status}: {result}')
    return result['result']['data']['json']

def eventually(check, label, timeout=40):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            result = check()
            if result: return result
        except (OSError, AssertionError): pass
        time.sleep(.5)
    raise AssertionError('Timed out: ' + label)

def main():
    server = None
    clients = []
    created = []
    assets = []
    suffix = str(time.time_ns())
    gateway_id = 'review-pi-' + suffix
    asset_id = 'urn:review:arm:' + suffix
    settings = types.SimpleNamespace(device_id=gateway_id, site_id='factory-a', line_id='line-1',
        mqtt_client_id=gateway_id, mqtt_username='review', mqtt_password='isolated-review-broker',
        mqtt_use_tls=False, mqtt_ca_cert='', local_mqtt_device_ids=('review-sensor',),
        ada031_control_asset_ids=(asset_id,))
    env = {k:v for k,v in os.environ.items() if not k.startswith(('AAS_', 'ONESA_', 'ASSISTANT_', 'SMTP_', 'RESEND_'))}
    env['DOTENV_CONFIG_PATH'] = '/dev/null'
    env.update(DATABASE_URL='postgres://postgres:postgres@127.0.0.1:55433/dashboard_e2e', DATABASE_SSL_MODE='disable',
        REDIS_URL='redis://127.0.0.1:56380', JWT_SECRET='isolated-review-jwt-secret-at-least-32-bytes',
        ENABLE_DEMO_ACCOUNTS='false', ENABLE_DEMO_DATA='false', ASSISTANT_PROVIDER='disabled',
        AAS_PROVISIONING_API_URL='http://127.0.0.1:55101/api/assets', AAS_PROVISIONING_TOKEN=TOKEN,
        AAS_REPOSITORY_URL='http://127.0.0.1:60401', AAS_ALLOW_UNAUTHENTICATED_LOCAL='true',
        AAS_OIDC_TOKEN_URL='', AAS_OIDC_DISCOVERY_URL='', AAS_OIDC_CLIENT_SECRET='',
        PORT='3101', NODE_ENV='development', INGESTION_API_TOKEN='isolated-review-ingestion-token')
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
    plain = urllib.request.build_opener()
    with tempfile.TemporaryDirectory(prefix='smart-factory-integration-') as temporary:
        log_path = Path(temporary) / 'dashboard.log'
        log = open(log_path, 'ab')
        state = DurableState(str(Path(temporary) / 'state.sqlite3'))
        profile_path = str(Path(temporary) / 'assets.json')
        writes = []
        acknowledgements = queue.Queue()
        serial_port = types.SimpleNamespace(write=lambda value: writes.append(value) or len(value), flush=lambda: None, close=lambda: None)
        manager = Ada031SerialCommandManager(serial_factory=lambda *a, **k: serial_port, sleeper=lambda _: None, command_state=state)

        def start_dashboard():
            process = subprocess.Popen(['pnpm', 'exec', 'tsx', 'server/_core/index.ts'], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            eventually(lambda: http(plain, '/health/ready')[0] == 200, 'dashboard readiness')
            return process

        def apply(profile):
            return save_asset_profile(profile_path, profile, gateway_id)

        def control(command):
            normalized, asset, byte = validate_command(settings, command, load_asset_connections(profile_path, gateway_id))
            return manager.execute(asset, normalized, byte)

        try:
            run(COMPOSE + ['up', '-d', '--build', '--wait'], stdout=log, stderr=subprocess.STDOUT)
            for port, path in [(60401,'shells'),(60402,'shell-descriptors'),(60403,'submodels'),(60404,'submodel-descriptors'),(60405,'concept-descriptions'),(60406,'packages')]:
                eventually(lambda p=port, route=path: http(plain, f'http://127.0.0.1:{p}/{route}')[0] == 200, 'disposable BaSyx readiness')
            aas_env = {**env, 'AAS_LIVE_TESTS':'true', 'AAS_REPOSITORY_URL':'http://127.0.0.1:60401', 'AAS_REGISTRY_URL':'http://127.0.0.1:60402', 'AAS_SUBMODEL_REPOSITORY_URL':'http://127.0.0.1:60403', 'AAS_SUBMODEL_REGISTRY_URL':'http://127.0.0.1:60404', 'AAS_CONCEPT_DESCRIPTION_REPOSITORY_URL':'http://127.0.0.1:60405', 'AASX_FILE_SERVER_URL':'http://127.0.0.1:60406'}
            run([os.environ.get('QUALIFICATION_DOTNET','dotnet'), 'test', str(ROOT.parent/'smart-factory-iot-backend/src/SmartFactory.Tests/SmartFactory.Tests.csproj'), '-c', 'Release', '--filter', 'FullyQualifiedName~AasxLiveIntegrationTests'], env=aas_env, stdout=log, stderr=subprocess.STDOUT)
            print('PASS: .NET 10 AASX import, 3.2 administrative metadata, semantic submodel and embedded attachment against disposable BaSyx', flush=True)
            run(['node', '--import', 'tsx', 'scripts/migrate-dashboard.ts'], env=env, stdout=log, stderr=subprocess.STDOUT)
            run(['node', '--import', 'tsx', 'scripts/security/seed-test-accounts.ts'], env=env, stdout=log, stderr=subprocess.STDOUT)
            server = start_dashboard()
            watcher = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='review-watch-' + suffix)
            watcher.username_pw_set('review', 'isolated-review-broker')
            watcher.on_connect = lambda client, userdata, flags, rc, properties: client.subscribe(command_topic(settings.site_id, settings.line_id, gateway_id) + '/ack', qos=1)
            watcher.on_message = lambda client, userdata, message: acknowledgements.put(json.loads(message.payload))
            watcher.connect('127.0.0.1', 51883)
            watcher.loop_start()
            clients.append(watcher)
            gateway = make_mqtt_client(settings, apply_configuration=apply, relay_ada031_control=control)
            gateway.connect('127.0.0.1', 51883)
            gateway.loop_start()
            clients.append(gateway)
            eventually(lambda: gateway.is_connected(), 'gateway MQTT connection')
            time.sleep(1)
            trpc(opener, 'auth.login', {'email': 'security-engineer@example.test', 'password': 'Synthetic-security-only-2026!'})
            device = trpc(opener, 'devices.create', {'deviceId': gateway_id, 'name': 'Review Pi', 'type': 'gateway', 'route': 'direct'})
            identity = dict(assetId=asset_id, name='Review Arm', assetType='robotic_arm', manufacturer='Review Works', model='Bench fixture',
                manufacturerStreet='Test 1', manufacturerZipcode='10000', manufacturerCityTown='Test', manufacturerNationalCode='DE',
                manufacturerArticleNumber='TEST-1', orderCodeOfManufacturer='TEST-1')
            asset = trpc(opener, 'assets.create', {**identity, 'connectionMode': 'gateway', 'gatewayDevicePk': device['id'],
                'protocol': 'ada031_v4_serial', 'endpoint': 'serial:///dev/bench-fixture?baudrate=9600', 'tagMappings': []})
            created.append(identity)
            assets.append(asset['id'])
            assert asset['provisioned'] is True and asset['edgeSync'] == 'published', asset
            eventually(lambda: Path(profile_path).is_file(), 'real backend profile applied by Pi')
            assert load_asset_connections(profile_path, gateway_id)[0]['assetId'] == asset_id
            print('PASS: Node asset creation -> .NET -> live BaSyx registration -> MQTT -> persisted Pi profile', flush=True)

            result = trpc(opener, 'assets.controlAda031', {
                'id': asset['id'],
                'command': {'action': 'jog', 'joint': 'base', 'direction': 'increase'},
            })
            eventually(lambda: writes == [b'o'], 'exact serial command byte')
            eventually(lambda: any_ack(acknowledgements, result['commandId'], 'serial_write_accepted'), 'serial acknowledgement')
            trpc(opener, 'devices.create', {'deviceId': 'review-sensor', 'name': 'Review sensor', 'type': 'sensor', 'route': 'gateway', 'gatewayId': gateway_id})
            trpc(opener, 'auth.logout', None)
            trpc(opener, 'auth.login', {'email': 'security-viewer@example.test', 'password': 'Synthetic-security-only-2026!'})
            status, _ = http(opener, '/api/trpc/assets.controlAda031', {'json': {
                'id': asset['id'],
                'command': {'action': 'jog', 'joint': 'base', 'direction': 'increase'},
            }})
            assert status == 403, status
            print('PASS: engineer command -> MQTT -> allowlisted simulated serial write/ack; viewer receives 403', flush=True)

            producer = DurablePublisher(gateway, state)
            timestamp = int(time.time() * 1000)
            sample = {
                'deviceId': 'review-sensor', 'assetId': asset_id, 'timestamp': timestamp,
                'sensorType': 'DHT11', 'sensorStatus': 'ok',
                'temperature': 42.5, 'humidity': 55.0, 'units': {'temperature': '°C', 'humidity': '%'},
                'integration': {**gateway_observation(), 'sessionId':'synthetic-cross-service','sequence':1},
                'assetSignals': {'bearingTemp': 74.5},
            }
            message = types.SimpleNamespace(topic='factory/factory-a/line-1/review-sensor/telemetry', payload=json.dumps(sample).encode())
            for _ in range(3): assert forward_local_message(settings, producer, message)
            eventually(producer.drain_one, 'cloud MQTT PUBACK')
            input = {'assetIds': [asset_id], 'startTime': timestamp - 1000, 'endTime': timestamp + 20000}
            eventually(lambda: trpc(opener, 'analytics.getAssetTelemetry', input, query=True)['overall']['sampleCount'] == 1, 'deduplicated dashboard telemetry')
            analytics = trpc(opener, 'analytics.getAssetTelemetry', input, query=True)
            assert next(signal for signal in analytics['assets'][0]['assetSignals'] if signal['name'] == 'bearingTemp')['latest'] == 74.5
            print('PASS: Pi-local sensor -> durable Pi queue -> real MQTT/.NET/PostgreSQL -> dashboard asset analytics, including signals', flush=True)

            stop_server(server)
            server = None
            sample['timestamp'] = int(time.time() * 1000)
            sample['temperature'] = 43.5
            sample['integration'] = {**gateway_observation(), 'sessionId':'synthetic-cross-service','sequence':2}
            message.payload = json.dumps(sample).encode()
            assert forward_local_message(settings, producer, message)
            eventually(producer.drain_one, 'second sample broker acceptance during dashboard outage')
            time.sleep(3)
            server = start_dashboard()
            trpc(opener, 'auth.login', {'email': 'security-viewer@example.test', 'password': 'Synthetic-security-only-2026!'})
            input['endTime'] = int(time.time() * 1000) + 1000
            eventually(lambda: trpc(opener, 'analytics.getAssetTelemetry', input, query=True)['overall']['sampleCount'] == 2, 'persisted backend retry after dashboard restart')
            print('PASS: dashboard outage/restart -> backend outbox retries -> both samples recovered without duplication', flush=True)
            answer = trpc(opener, 'assistant.ask', {'question': 'What is the latest temperature on Review Arm?', 'selectedAssetId': asset_id})
            assert '43.5' in answer['answer']
            print('PASS: Assistant retrieves the recovered asset-specific latest sample', flush=True)

            run(COMPOSE + ['stop', 'backend-database'], stdout=log, stderr=subprocess.STDOUT)
            def health(path):
                return subprocess.check_output(COMPOSE + ['exec', '-T', 'telemetry-service', 'curl', '--max-time', '8', '-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:8080' + path], cwd=ROOT, text=True).strip()
            eventually(lambda: health('/health/ready') == '503', 'worker readiness detects database outage')
            assert health('/health/live') == '200'
            run(COMPOSE + ['start', 'backend-database'], stdout=log, stderr=subprocess.STDOUT)
            eventually(lambda: health('/health/ready') == '200', 'worker readiness recovers')
            print('PASS: telemetry database outage removes readiness while liveness remains responsive; readiness recovers', flush=True)
        except Exception:
            log.flush()
            retained_log = Path(tempfile.gettempdir()) / ('smart-factory-integration-' + suffix + '.log')
            shutil.copyfile(log_path, retained_log)
            print('Integration failure; test log: ' + str(retained_log), file=sys.stderr)
            raise
        finally:
            for identity in created:
                try:
                    status, _ = http(plain, 'http://127.0.0.1:55101/api/assets', identity, 'DELETE', {'X-AAS-Provisioning-Token': TOKEN})
                    if status != 200: print('Test AAS cleanup requires inspection: ' + identity['assetId'], file=sys.stderr)
                except OSError: print('Test AAS cleanup requires inspection: ' + identity['assetId'], file=sys.stderr)
            if server is not None: stop_server(server)
            for client in clients:
                client.disconnect()
                client.loop_stop()
            manager.close()
            state.close()
            run(COMPOSE + ['down', '--volumes', '--remove-orphans'], stdout=log, stderr=subprocess.STDOUT)
            log.close()

def stop_server(process):
    import signal
    os.killpg(process.pid, signal.SIGTERM)
    try: process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)

def any_ack(messages, identity, status):
    while not messages.empty():
        value = messages.get_nowait()
        if value.get('commandId') == identity and value.get('status') == status: return True
    return False

if __name__ == '__main__': main()
