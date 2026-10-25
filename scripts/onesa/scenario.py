"""Reproducible simulator through the EXISTING edge relay and real MQTT broker.

No PLC access or writes. Requires edge .venv and the isolated walkthrough stack.
Observation and run identities are deterministic. Repeating the same run deduplicates.
"""
import json
from pathlib import Path
import sys
import tempfile
import time
import types
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[2]
EDGE=ROOT.parent/'smart-factory-iot-edge'/'raspberry-pi'/'src'
sys.path.insert(0,str(EDGE))
import paho.mqtt.client as mqtt
from sensor_gateway import forward_local_message
from durable_state import DurableState,DurablePublisher

def main():
 equipment=json.loads((ROOT/'fixtures/equipment/equipment.json').read_text())
 run=sys.argv[1] if len(sys.argv)>1 else 'deterministic-pump-v1'
 settings=types.SimpleNamespace(device_id='onesa-demo-gateway',site_id='onesa-fixture',line_id='line-1',local_mqtt_device_ids=('onesa-demo-gateway',))
 client=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,client_id='onesa-scenario-publisher')
 client.connect('127.0.0.1',51884);client.loop_start()
 deadline=time.monotonic()+10
 while not client.is_connected():
  if time.monotonic()>deadline: raise RuntimeError('Fixture broker unavailable')
  time.sleep(.05)
 with tempfile.TemporaryDirectory(prefix='onesa-scenario-') as state_dir:
  state=DurableState(str(Path(state_dir)/'outbox.sqlite3'))
  publisher=DurablePublisher(client,state)
  base=1792486800000 # 2026-10-20T09:00:00Z; immutable, simulated historical observations.
  for r in equipment:
   for index,(scenario,pressure,temp,vibration,online) in enumerate([('normal',2.,45.,1.,True),('threshold',7.,90.,9.,True),('recovery',2.,46.,1.,True),('disconnected',None,None,None,False),('stale',2.,46.,1.,True)]):
    at=base+index*1000;received=at+(120000 if scenario=='stale' else 0)
    stamp=lambda value:datetime.fromtimestamp(value/1000,timezone.utc).isoformat().replace('+00:00','Z')
    p={'deviceId':settings.device_id,'assetId':r['externalAssetId'],'timestamp':at,'temperature':temp,'pressure':pressure,'vibration':vibration,'rpm':1450. if online else None,
     'integration':{'mode':'simulated','scenarioRunId':run,'sessionId':run,'sequence':index,'sourceQuality':'good' if online else 'unknown','sourceConnection':'online' if online else 'offline','timestampOrigin':'device','retained':scenario=='stale','gatewayReceivedAt':stamp(received)}}
    if scenario in ('threshold','recovery'):p['integration']['sourceEvents']=[{'id':run+':bearing-temperature','origin':'source','code':'simulated-bearing-temperature','state':'active' if scenario=='threshold' else 'cleared','componentId':r['components'][2]['componentId']}]
    msg=types.SimpleNamespace(topic=f'factory/{settings.site_id}/{settings.line_id}/{settings.device_id}/telemetry',payload=json.dumps(p).encode(),retain=scenario=='stale')
    assert forward_local_message(settings,publisher,msg)
  while publisher.drain_one(): pass
  state.close();time.sleep(1)
  print('Published 10 simulated source samples through existing durable edge relay and real MQTT, run '+run)
 client.disconnect();client.loop_stop()
if __name__=='__main__':main()
