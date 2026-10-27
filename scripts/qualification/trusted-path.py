#!/usr/bin/env python3
"""Real disposable edge spool -> MQTT -> .NET 10 -> Node -> PostgreSQL qualification.

Uses only this script's loopback Compose project and synthetic inputs. No commands,
plant connections, provider email, Onesa consumer or production deployment.
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import urllib.request
import urllib.error

ROOT=Path(__file__).resolve().parents[2]
BACKEND=ROOT.parent/'smart-factory-iot-backend'
EDGE=ROOT.parent/'smart-factory-iot-edge'/'raspberry-pi'/'src'
sys.path.insert(0,str(EDGE))
import paho.mqtt.client as mqtt
from durable_state import DurableState,DurablePublisher
from sensor_gateway import make_local_mqtt_client,connect_local_mqtt
from mqtt_topics import topic as encoded_topic
COMPOSE=['docker','compose','--env-file','/dev/null','-p','smart-factory-trusted-path','-f',str(ROOT/'scripts/qualification/compose.yaml')]
BROKER=os.environ.get('MQTT_PROOF_BROKER','rabbitmq')
if BROKER not in {'rabbitmq','mosquitto'}:raise ValueError('Only disposable RabbitMQ/Mosquitto qualification is supported')
if BROKER=='mosquitto':COMPOSE.extend(['-f',str(ROOT/'scripts/qualification/compose.mosquitto.yaml')])
BASE='http://127.0.0.1:3124' 
TOKEN='synthetic-trusted-path-ingestion-credential-32bytes'

def run(args,**kw):
    kw.setdefault('cwd',ROOT)
    return subprocess.run(args,check=True,**kw)
def eventually(check,label,timeout=40):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        try:
            value=check()
            if value:return value
        except (OSError,AssertionError,subprocess.CalledProcessError):pass
        time.sleep(.2)
    raise AssertionError('Timed out: '+label)
def http(path):
    try:
        with urllib.request.urlopen(BASE+path,timeout=5)as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:return e.code,None

def stop(process):
    if process is None or process.poll()is not None:return
    os.killpg(process.pid,signal.SIGTERM)
    try:process.wait(timeout=10)
    except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=5)

def main():
    worker=node=None;client=None;state=None;local=None;source_client=None
    output=Path(os.environ.get('QUALIFICATION_EVIDENCE_DIR',tempfile.mkdtemp(prefix='factory-trusted-proof-')))
    output.mkdir(parents=True,exist_ok=True)
    env={**os.environ,'DOTENV_CONFIG_PATH':'/dev/null','NODE_ENV':'development','DATABASE_SSL_MODE':'disable',
         'DATABASE_URL':'postgres://postgres:postgres@127.0.0.1:55452/smart_factory_trusted_e2e',
         'REDIS_URL':'redis://127.0.0.1:56402','PORT':'3124','ENABLE_DEMO_ACCOUNTS':'false','ENABLE_DEMO_DATA':'false',
         'PUBLIC_DEMO_DEPLOYMENT':'false','ASSISTANT_PROVIDER':'disabled','ONESA_ENABLED':'false','API_ONLY':'true',
         'BACKEND_DEPLOYMENT_MODE':'standalone','JWT_SECRET':'synthetic-trusted-path-session-credential-32bytes','INGESTION_API_TOKEN':TOKEN,
         'INTERNAL_TELEMETRY_SINK_URL':BASE+'/api/internal/telemetry','DOTNET_ENVIRONMENT':'Development',
         'PostgresConnectionString':'Host=127.0.0.1;Port=55452;Database=telemetry_trusted_e2e;Username=postgres;Password=postgres;SSL Mode=Disable',
         'TELEMETRY_MIGRATIONS_DIR':str(BACKEND/'deploy/migrations'),'MqttBrokerHost':'127.0.0.1','MqttBrokerPort':'51889',
         'MqttUseTls':'false','MqttClientId':'trusted-path-singleton','MqttUsername':'review','MqttPassword':'isolated-review-broker'}
    for key in list(env):
        if key.startswith('ONESA_')or key.startswith('ASSISTANT_')and key!='ASSISTANT_PROVIDER' or key.startswith('AAS_') or key.startswith('SMTP_') or key.startswith('RESEND_'):env.pop(key,None)
    dotnet=os.environ.get('QUALIFICATION_DOTNET','dotnet')
    dll=str(BACKEND/'src/Services/TelemetryService/bin/Release/net10.0/TelemetryService.dll')
    logs=open(output/'services.log','wb')
    def launch_node():
        process=subprocess.Popen(['node','--import','tsx','server/_core/index.ts'],cwd=ROOT,env=env,stdout=logs,stderr=subprocess.STDOUT,start_new_session=True)
        eventually(lambda:http('/health/ready')[0]==200,'Node readiness');return process
    def launch_worker():
        values={**env,'PORT':'51890'}
        return subprocess.Popen([dotnet,dll],cwd=BACKEND,env=values,stdout=logs,stderr=subprocess.STDOUT,start_new_session=True)
    def sql(statement,database='telemetry_trusted_e2e'):
        return subprocess.check_output(COMPOSE+['exec','-T','database','psql','-U','postgres','-d',database,'-At','-c',statement],cwd=ROOT,text=True).strip()
    def snapshot():
        return json.loads(subprocess.check_output(['node','--import','tsx','scripts/qualification/trusted-fixture.mts','status'],cwd=ROOT,env=env,text=True))
    def pending():return int(sql('select count(*) from "TelemetryRecords" where "DashboardForwardedAt" is null and "DeliveryQuarantinedAt" is null'))
    evidence={'environment':'disposable-local','broker':BROKER,'physicalEquipment':False,'consumerAcceptance':False,'productionPromotion':False,'checks':[]}
    def passed(name,**details):
        evidence['checks'].append({'name':name,**details});print('PASS: '+name,flush=True)
    try:
        run(COMPOSE+['up','-d','--wait'],stdout=logs,stderr=subprocess.STDOUT)
        run(COMPOSE+['exec','-T','database','createdb','-U','postgres','telemetry_trusted_e2e'],stdout=logs,stderr=subprocess.STDOUT)
        run(['node','--import','tsx','scripts/migrate-dashboard.ts'],env=env,stdout=logs,stderr=subprocess.STDOUT)
        run(['node','--import','tsx','scripts/qualification/trusted-fixture.mts','seed'],env=env,stdout=logs,stderr=subprocess.STDOUT)
        run([dotnet,dll,'--migrate'],cwd=BACKEND,env=env,stdout=logs,stderr=subprocess.STDOUT)
        worker=launch_worker()
        def ready_worker():
            try:
                with urllib.request.urlopen('http://127.0.0.1:51890/health/ready',timeout=2)as r:return r.status==200
            except OSError:return False
        eventually(ready_worker,'MQTT subscription')
        client=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,client_id='trusted-path-edge-publisher');client.username_pw_set('review','isolated-review-broker');client.connect('127.0.0.1',51889);client.loop_start()
        eventually(client.is_connected,'publisher connection')
        state=DurableState(str(output/'edge-spool.sqlite3'));publisher=DurablePublisher(client,state)
        now=int(time.time()*1000)-1000
        def sample(offset=0,mode='live',**changes):
            at=now+offset
            provenance={'mode':mode,'sourceQuality':'good','sourceConnection':'online','gatewayReceivedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(at/1000))}
            if mode=='simulated':provenance['scenarioRunId']='isolated-trusted-simulation'
            if mode=='replay':provenance['replayRunId']='isolated-trusted-replay'
            value={'deviceId':'sensor.temp:01','gatewayId':'gateway:01','assetId':'urn:qualification:motor','timestamp':at,'temperature':77,'power':1.5,'units':{'temperature':'°F','power':'kW'},'integration':provenance,'transportRetainVerified':True}
            value.update(changes);return value
        topic=encoded_topic('site:01','line.01','sensor.temp:01','telemetry')
        def publish(value,topic_name=topic,retain=False):
            result=client.publish(topic_name,json.dumps(value),qos=1,retain=retain);result.wait_for_publish(timeout=5);assert result.is_published()
        # Real Pi-local MQTT ingress validates identity and retained context,
        # then the actual durable publisher crosses the independent cloud broker.
        settings=SimpleNamespace(device_id='gateway:01',site_id='site:01',line_id='line.01',local_mqtt_device_ids=('sensor.temp:01',),local_mqtt_client_id='trusted-local-gateway',local_mqtt_username='',local_mqtt_use_tls=False,local_mqtt_host='127.0.0.1',local_mqtt_port=51888,telemetry_coalescing_enabled=False)
        local=make_local_mqtt_client(settings,publisher);connect_local_mqtt(local,settings);local.loop_start()
        eventually(lambda:local._transport_verified,'Pi local retained-delivery subscription verification')
        source_client=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,client_id='trusted-local-sensor');source_client.connect('127.0.0.1',51888);source_client.loop_start()
        eventually(source_client.is_connected,'local sensor connection')
        source=sample();source.pop('gatewayId');source.pop('transportRetainVerified')
        info=source_client.publish(topic,json.dumps(source),qos=1);info.wait_for_publish(timeout=5)
        eventually(lambda:state.first()is not None,'Pi local durable acceptance')
        live=json.loads(state.first()[2]);assert live['deviceId']=='sensor.temp:01' and live['transportRetainVerified']is True
        eventually(publisher.drain_one,'edge spool PUBACK')
        for _ in range(2):publish(live)
        publish(sample(10,'simulated',power=9));publish(sample(20,'replay',power=4))
        legacy=sample(30,deviceId='sensor-01');legacy.pop('integration');legacy.pop('units');legacy.pop('gatewayId');publish(legacy,encoded_topic('site:01','line.01','sensor-01','telemetry'))
        bad=sample(40,power=8);bad['integration']['sourceQuality']='bad';publish(bad)
        eventually(lambda:int(sql('select count(*) from "TelemetryRecords"'))==5,'durable worker intake during receiver outage')
        assert pending()==5
        stop(worker);worker=None
        node=launch_node();worker=launch_worker()
        eventually(lambda:pending()==0,'outbox delivery after worker and receiver restart')
        first=snapshot();assert len(first['readings'])==5,first
        assert len(first['incidents'])==1 and first['incidents'][0]['occurrences']==1,first['incidents']
        primary=next(r for r in first['readings']if int(r['timestamp'])==now)
        assert primary['temperature']==25 and primary['power']==1500,primary
        assert primary['measurements']['power']['sourceUnit']=='kW' and primary['measurements']['power']['sourceValue']==1.5
        assert first['liveInventory'][0]['mode']=='live',first['liveInventory']
        passed('punctuated and legacy IDs cross actual MQTT/.NET/Node; conversions and scoped latest survive restart',stored=5,canonicalPowerW=1500,canonicalTemperatureC=25)
        local_retained=sample(45,power=8);local_retained.pop('gatewayId');local_retained.pop('transportRetainVerified')
        info=source_client.publish(topic,json.dumps(local_retained),qos=1,retain=True);info.wait_for_publish(timeout=5)
        eventually(lambda:state.first()is not None,'Pi-local retained acquisition')
        forwarded=json.loads(state.first()[2]);assert forwarded['transportRetained']is True and forwarded['transportRetainVerified']is True,forwarded
        eventually(publisher.drain_one,'Pi-local retained spool PUBACK')
        eventually(lambda:int(sql('select count(*) from "TelemetryRecords"'))==6 and pending()==0,'Pi-local retained evidence remains historical')
        passed('Pi-local MQTT 5 retains the original delivery flag through its durable cloud forwarding')
        # A retained delivery acquired while disconnected must remain historical.
        stop(worker);worker=None
        retained=sample(50,power=9);publish(retained,retain=True)
        worker=launch_worker();eventually(ready_worker,'resubscription')
        eventually(lambda:int(sql('select count(*) from "TelemetryRecords"'))==7 and pending()==0,'retained historical delivery')
        later=sample(-3600000,power=7);publish(later)
        publish(sample(55,power=8,transportRetainVerified=False))
        publish(sample(60,gatewayId='different:gateway'))
        unknown=sample(70,deviceId='unknown:01');publish(unknown,encoded_topic('site:01','line.01','unknown:01','telemetry'))
        eventually(lambda:int(sql('select count(*) from "TelemetryRecords" where "DeliveryQuarantinedAt" is not null'))==2,'permanent route/identity quarantine')
        eventually(lambda:pending()==0,'historical evidence drain')
        final=snapshot();assert len(final['readings'])==9,final
        assert final['incidents']==first['incidents'],(first['incidents'],final['incidents'])
        source=next(s for s in final['sources']if s['deviceId']=='sensor.temp:01')
        assert source['metadata']['commissioning']['gatewayId']=='gateway:01',source
        assert len(final['sources'])==3
        retained_row=next(r for r in final['readings']if int(r['timestamp'])==now+50)
        assert retained_row['integration']['evidence']['eligible']is False,retained_row
        assert retained_row['integration']['observedRoute']['transportRetained']is True,retained_row
        unverified=next(r for r in final['readings']if int(r['timestamp'])==now+55)
        assert unverified['integration']['evidence']['reason']=='transport_flags_unverified',unverified
        passed('retained, delayed, bad quality and mixed modes never assert new current incidents or rewrite topology',currentIncidents=1,storedHistorical=9,quarantined=2)
        publish(live);eventually(lambda:pending()==0,'duplicate retry drain');assert len(snapshot()['readings'])==9
        passed('duplicate redelivery after restart preserves one reading and one current effect')
        # Backup only owned disposable storage, restore into new names, compare evidence.
        stop(worker);worker=None;stop(node);node=None
        restores=[]
        for database,table in [('smart_factory_trusted_e2e','sensor_readings'),('telemetry_trusted_e2e','"TelemetryRecords"')]:
            archive=output/(database+'.dump')
            with archive.open('wb')as destination:run(COMPOSE+['exec','-T','database','pg_dump','-U','postgres','-Fc',database],stdout=destination)
            restored=database.replace('_e2e','_restored_e2e')
            run(COMPOSE+['exec','-T','database','createdb','-U','postgres',restored],stdout=logs,stderr=subprocess.STDOUT)
            with archive.open('rb')as source_file:run(COMPOSE+['exec','-T','database','pg_restore','-U','postgres','--exit-on-error','--no-owner','-d',restored],stdin=source_file,stdout=logs,stderr=subprocess.STDOUT)
            tables=[table,'alerts','devices','asset_devices','incident_activity'] if database.startswith('smart_factory') else [table,'telemetry_schema_migrations']
            verified=[]
            for name in tables:
                fingerprint=f"select count(*)::text||':'||coalesce(md5(string_agg(row::text,E'\\n' order by row::text)),'empty') from(select to_jsonb(t) as row from {name} t) data"
                original=sql(fingerprint,database);recovered=sql(fingerprint,restored);assert original==recovered,(name,original,recovered)
                verified.append({'table':name,'identity':recovered})
            restores.append({'database':database,'tables':verified,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()})
        env['DATABASE_URL']='postgres://postgres:postgres@127.0.0.1:55452/smart_factory_trusted_restored_e2e'
        env['PostgresConnectionString']=env['PostgresConnectionString'].replace('Database=telemetry_trusted_e2e','Database=telemetry_trusted_restored_e2e')
        node=launch_node();worker=launch_worker();eventually(ready_worker,'worker readiness on restored databases')
        assert http('/api/runtime/contract')[1]['schema']['ready'] is True
        passed('disposable dashboard and telemetry backup/restore preserves evidence identities and restarts services',restores=restores)
        evidence['completedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime());(output/'result.json').write_text(json.dumps(evidence,indent=2)+'\n')
        print('Evidence: '+str(output/'result.json'),flush=True)
    finally:
        stop(worker);stop(node)
        if source_client:source_client.disconnect();source_client.loop_stop()
        if local:local.disconnect();local.loop_stop()
        if client:client.disconnect();client.loop_stop()
        if state:state.close()
        run(COMPOSE+['down','--volumes','--remove-orphans'],stdout=logs,stderr=subprocess.STDOUT);logs.close()

if __name__=='__main__':main()
