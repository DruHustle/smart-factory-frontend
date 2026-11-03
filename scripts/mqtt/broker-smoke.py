#!/usr/bin/env python3
"""Disposable TLS/ACL/QoS/persistence check for the Oracle Mosquitto stack.

No production endpoints or credentials are used. Requires Docker, openssl and
paho-mqtt 2.x. The isolated Compose project and temporary directory are removed.
"""
from __future__ import annotations
import os, secrets, socket, subprocess, tempfile, threading, time
from pathlib import Path
import paho.mqtt.client as mqtt
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.properties import Properties

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / 'deploy/oracle/mosquitto/compose.yaml'
IMAGE = 'eclipse-mosquitto:2.1.2-alpine@sha256:860aeb5d63ce509508f6dcfb2bc8a1c1dd2bc60555b562b45ce90e52d8dabb0f'
PROJECT = 'sf-mqtt-broker-test-' + secrets.token_hex(4)
PASSWORD = 'synthetic-test-password-not-production'
TOPIC = 'factory/factory-a/line-1/esp32-wrover-01/telemetry'

def run(args, env=None, quiet=False):
    return subprocess.run(args, check=True, env=env, stdout=subprocess.DEVNULL if quiet else None, stderr=subprocess.DEVNULL if quiet else None)

def connect(port, ca, user, client_id, *, persistent=False, version=mqtt.MQTTv5, on_message=None):
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id, protocol=version,
                         **({'clean_session': False} if version == mqtt.MQTTv311 else {}))
    client.username_pw_set(user, PASSWORD)
    client.tls_set(ca_certs=str(ca))
    connected = threading.Event()
    result = []
    def on_connect(_client, _userdata, _flags, reason_code, _props=None):
        result.append(reason_code); connected.set()
    client.on_connect = on_connect
    if on_message: client.on_message = on_message
    properties = Properties(PacketTypes.CONNECT) if version == mqtt.MQTTv5 and persistent else None
    if properties: properties.SessionExpiryInterval = 300
    kwargs = {'clean_start': False if persistent else mqtt.MQTT_CLEAN_START_FIRST_ONLY, 'properties': properties} if version == mqtt.MQTTv5 else {}
    client.connect('localhost', port, 15, **kwargs)
    client.loop_start()
    if not connected.wait(10) or not result or result[0].is_failure:
        client.loop_stop(); raise AssertionError(f'{user}: connection rejected')
    return client

def subscribe(client, topic, qos):
    complete = threading.Event(); results=[]
    def on_subscribe(_c, _u, _mid, reasons, _props=None):
        results.extend(reasons); complete.set()
    client.on_subscribe = on_subscribe
    result, _ = client.subscribe(topic, qos=qos)
    assert result == mqtt.MQTT_ERR_SUCCESS and complete.wait(10) and results and not results[0].is_failure

def publish(client, topic, payload, qos):
    info = client.publish(topic, payload, qos=qos)
    info.wait_for_publish(10)
    assert info.is_published(), f'publish QoS {qos} failed'

def main():
    with tempfile.TemporaryDirectory(prefix='sf-mqtt-smoke-') as temp:
        directory = Path(temp); directory.chmod(0o755)
        run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(directory/'server.key'),'-out',str(directory/'server.crt'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'], quiet=True)
        (directory/'ca.crt').write_bytes((directory/'server.crt').read_bytes())
        (directory/'health-password').write_text(PASSWORD)
        for i,user in enumerate(['sf-gateway','sf-worker','sf-control','sf-health']):
            # Use the invoking user so Linux bind mounts do not leave a root-
            # owned synthetic password file that the runner cannot manage.
            args=['docker','run','--rm','--user',f'{os.getuid()}:{os.getgid()}','-v',f'{directory}:/work','--entrypoint','mosquitto_passwd',IMAGE]
            if i == 0: args.append('-c')
            run(args+['-b','/work/passwords',user,PASSWORD],quiet=True)
        for path in directory.iterdir(): path.chmod(0o644)
        with socket.socket() as s: s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
        env=os.environ | {'MQTT_SECRET_DIR':str(directory),'MQTT_BIND_ADDRESS':'127.0.0.1','MQTT_PORT':str(port)}
        compose=['docker','compose','--env-file','/dev/null','-p',PROJECT,'-f',str(CONFIG)]
        clients=[]
        try:
            run(compose+['up','-d','--wait'],env)
            worker=connect(port,directory/'ca.crt','sf-worker','smoke-worker'); clients.append(worker)
            gateway=connect(port,directory/'ca.crt','sf-gateway','smoke-gateway'); clients.append(gateway)
            received=[]; delivered=threading.Event()
            def on_message(_c,_u,message): received.append((message.payload.decode(),message.qos)); delivered.set()
            worker.on_message=on_message
            subscribe(worker,TOPIC,2)
            for level in (0,1,2):
                delivered.clear(); publish(gateway,TOPIC,f'synthetic-{level}',level)
                assert delivered.wait(10) and received[-1]==(f'synthetic-{level}',level), f'QoS {level} did not match'
            # The production MQTT 5 worker depends on retain-as-published to
            # distinguish retained evidence from current live measurements.
            retain_topic = 'factory/factory-a/line-1/synthetic-broker-validation/heartbeat'
            retained = []; retained_event = threading.Event()
            observer = connect(port, directory/'ca.crt', 'sf-worker', 'smoke-retain',
                on_message=lambda _c, _u, m: (retained.append((m.payload, m.retain)), retained_event.set()))
            clients.append(observer)
            subscription_done = threading.Event(); subscription_results = []
            def on_subscribe(_c, _u, _mid, reasons, _props=None):
                subscription_results.extend(reasons); subscription_done.set()
            observer.on_subscribe = on_subscribe
            result, _ = observer.subscribe(retain_topic, options=mqtt.SubscribeOptions(qos=1, retainAsPublished=True))
            assert result == mqtt.MQTT_ERR_SUCCESS and subscription_done.wait(10) and subscription_results and not subscription_results[0].is_failure
            publication = gateway.publish(retain_topic, b'synthetic-retained', qos=1, retain=True)
            publication.wait_for_publish(10)
            assert publication.is_published() and retained_event.wait(10) and retained[-1] == (b'synthetic-retained', True), 'MQTT 5 lost the retain-as-published flag'
            publication = gateway.publish(retain_topic, b'', qos=1, retain=True)
            publication.wait_for_publish(10)
            assert publication.is_published(), 'Could not clear disposable retained message'
            # A separate MQTT 3.1.1 client covers the installed Pi cloud client.
            legacy=connect(port,directory/'ca.crt','sf-gateway','smoke-legacy',version=mqtt.MQTTv311); clients.append(legacy)
            delivered.clear(); publish(legacy,TOPIC,'legacy',1)
            assert delivered.wait(10) and received[-1]==('legacy',1)
            # A command-only identity cannot publish telemetry even if authenticated.
            control=connect(port,directory/'ca.crt','sf-control','smoke-control'); clients.append(control)
            received.clear(); delivered.clear(); control.publish(TOPIC,'unauthorized',qos=1)
            assert not delivered.wait(2), 'ACL allowed the command identity to publish telemetry'
            # Persistent QoS 2 subscription survives a clean broker restart.
            saved=connect(port,directory/'ca.crt','sf-worker','smoke-persistent',persistent=True); clients.append(saved)
            subscribe(saved,TOPIC,2); saved.disconnect(); saved.loop_stop(); clients.remove(saved)
            publish(gateway,TOPIC,'queued-through-restart',2)
            run(compose+['restart','broker'],env)
            for client in clients: client.disconnect(); client.loop_stop()
            clients.clear(); time.sleep(2)
            restore_event=threading.Event(); restored_messages=[]
            def on_restored(_c,_u,message): restored_messages.append((message.payload.decode(),message.qos)); restore_event.set()
            restored=connect(port,directory/'ca.crt','sf-worker','smoke-persistent',persistent=True,on_message=on_restored); clients.append(restored)
            subscribe(restored,TOPIC,2)
            assert restore_event.wait(10) and ('queued-through-restart',2) in restored_messages, 'Persistent QoS 2 message did not survive restart'
            print('PASS: TLS, role ACLs, MQTT 3.1.1/5, retain-as-published, QoS 0/1/2 and broker restart persistence')
        finally:
            for client in clients:
                client.disconnect(); client.loop_stop()
            run(compose+['down','--volumes','--remove-orphans'],env,quiet=True)

if __name__ == '__main__': main()
