"""Controlled operations for the one-time Render to Oracle cutover."""
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.request


def api(service, path='', method='GET'):
    request = urllib.request.Request(
        'https://api.render.com/v1/services/' + service + path,
        method=method,
        headers={'Authorization': 'Bearer ' + os.environ['RENDER_API_KEY'],
                 'Accept': 'application/json'},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response) if response.status != 204 else None


action = sys.argv[1]
services = {'api': os.environ['RENDER_WEB_SERVICE_ID'],
            'worker': os.environ['RENDER_WORKER_SERVICE_ID']}
if action == 'snapshot':
    snapshot = {}
    for role, service in services.items():
        variables = []
        cursor = ''
        while True:
            import urllib.parse
            page = api(service, '/env-vars?limit=100' + ('&cursor=' + urllib.parse.quote(cursor) if cursor else ''))
            variables.extend(item['envVar'] for item in page)
            if len(page) < 100:
                break
            cursor = page[-1]['cursor']
        snapshot[role] = {'service': api(service), 'variables': variables}
    # Plaintext travels only through a pipe; the artifact is encrypted to a
    # short-lived migration certificate whose private key stays on the operator's Mac.
    subprocess.run(['openssl', 'cms', '-encrypt', '-binary', '-aes-256-cbc',
                    '-outform', 'DER', '-out', 'oracle-runtime.enc',
                    'deploy/oracle/transfer.crt'],
                   input=json.dumps(snapshot).encode(), check=True)
    print('Encrypted both live runtime configurations for the Oracle migration.')
elif action in ('suspend-worker', 'resume-worker', 'suspend-api', 'resume-api'):
    operation, role = action.split('-')
    api(services[role], '/' + operation, 'POST')
    state = api(services[role])
    print(role + ' state: ' + str(state.get('suspended')))
else:
    raise ValueError('Unsupported migration action')
