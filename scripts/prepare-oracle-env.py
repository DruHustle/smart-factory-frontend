"""Write owner-only Compose raw env files from a decrypted Render snapshot."""
import json
import os
from pathlib import Path
import re
import sys


snapshot = json.loads(Path(sys.argv[1]).read_text())
destination = Path(sys.argv[2])
destination.mkdir(parents=True, exist_ok=True)
environments = {}
for role in ('api', 'worker'):
    values = {item['key']: item['value'] for item in snapshot[role]['variables']}
    if role == 'api':
        values['DATABASE_SSL_MODE'] = 'verify-full'
    else:
        values['DASHBOARD_API_ORIGIN'] = 'https://api.152-70-22-84.sslip.io'
    environments[role] = values

for key in ('DATABASE_URL', 'INGESTION_API_TOKEN', 'DASHBOARD_SERVICE_TOKEN'):
    if not environments['api'].get(key) or environments['api'][key] != environments['worker'].get(key):
        raise ValueError('The two roles must share matching ' + key)
if not environments['worker'].get('MqttClientId'):
    raise ValueError('Preserve the existing singleton worker MQTT client ID')

for role, values in environments.items():
    lines = []
    for key, value in sorted(values.items()):
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key):
            raise ValueError('Invalid environment variable name')
        if '\n' in value or '\r' in value:
            if key != 'DATABASE_CA_CERT':
                raise ValueError('Unexpected multiline value in ' + key)
            value = value.replace('\r\n', '\n').replace('\n', '\\n')
        lines.append(key + '=' + value)
    path = destination / ('.env.' + role)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        output.write('\n'.join(lines) + '\n')
    path.chmod(0o600)
    print('Prepared ' + role + ' configuration; values were not printed.')
