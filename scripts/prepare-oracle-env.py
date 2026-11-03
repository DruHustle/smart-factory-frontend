"""Write owner-only Compose raw env files from a decrypted deployment snapshot."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re


# Reuse the maintained origin validation without executing deployment commands.
spec = importlib.util.spec_from_file_location("oracle_environment_origins", Path(__file__).with_name("deploy-vm.py"))
origins = importlib.util.module_from_spec(spec)
spec.loader.exec_module(origins)


def prepare_environments(snapshot, api_origin=origins.DEFAULT_API_ORIGIN, ui_origin=None):
    api_origin = origins.https_origin(api_origin, "API origin")
    if ui_origin is not None:
        ui_origin = origins.https_origin(ui_origin, "UI origin")
    environments = {
        role: {item['key']: item['value'] for item in snapshot[role]['variables']}
        for role in ('api', 'worker')
    }
    environments['api']['DATABASE_SSL_MODE'] = 'verify-full'
    environments['worker']['DASHBOARD_API_ORIGIN'] = api_origin

    for key in ('DATABASE_URL', 'INGESTION_API_TOKEN', 'DASHBOARD_SERVICE_TOKEN'):
        if not environments['api'].get(key) or environments['api'][key] != environments['worker'].get(key):
            raise ValueError('The two roles must share matching ' + key)
    if not environments['worker'].get('MqttClientId'):
        raise ValueError('Preserve the existing singleton worker MQTT client ID')

    if ui_origin is not None:
        # An explicit cutover preserves existing allowed origins and adds the new
        # canonical frontend; both reset senders must then use the same target.
        allowed = [origins.https_origin(value.strip(), 'ALLOWED_ORIGIN entry')
                   for value in environments['api'].get('ALLOWED_ORIGIN', '').split(',') if value.strip()]
        environments['api']['ALLOWED_ORIGIN'] = ','.join(dict.fromkeys([*allowed, ui_origin]))
        for values in environments.values():
            values['PASSWORD_RESET_ORIGIN'] = ui_origin
    else:
        reset = [values.get('PASSWORD_RESET_ORIGIN') for values in environments.values()]
        multiple = any(origins.csv_count(values.get('ALLOWED_ORIGIN')) > 1 for values in environments.values())
        if multiple and not all(reset):
            raise ValueError('Multiple ALLOWED_ORIGIN values require --ui-origin or matching explicit PASSWORD_RESET_ORIGIN on both roles')
        configured = [origins.https_origin(value, 'PASSWORD_RESET_ORIGIN') for value in reset if value]
        if len(set(configured)) > 1:
            raise ValueError('The two roles must share one PASSWORD_RESET_ORIGIN; select --ui-origin for a reviewed cutover')

    return environments


def environment_bytes(values):
    lines = []
    for key, value in sorted(values.items()):
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key):
            raise ValueError('Invalid environment variable name')
        if '\n' in value or '\r' in value:
            if key != 'DATABASE_CA_CERT':
                raise ValueError('Unexpected multiline value in ' + key)
            value = value.replace('\r\n', '\n').replace('\n', '\\n')
        lines.append(key + '=' + value)
    return ('\n'.join(lines) + '\n').encode('utf-8')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--api-origin', default=os.environ.get('SMART_FACTORY_API_ORIGIN', origins.DEFAULT_API_ORIGIN))
    parser.add_argument('--ui-origin', default=os.environ.get('SMART_FACTORY_UI_ORIGIN'),
                        help='Explicit canonical frontend for a reviewed cutover; sets matching reset origins and adds it to the API allowlist')
    args = parser.parse_args(argv)
    # Validate both role outputs before creating or changing destination files.
    environments = prepare_environments(json.loads(args.snapshot.read_text()), args.api_origin, args.ui_origin)
    contents = {role: environment_bytes(values) for role, values in environments.items()}
    args.destination.mkdir(parents=True, exist_ok=True)
    for role in contents:
        path = args.destination / ('.env.' + role)
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise ValueError('Expected a regular environment output file')
    for role, data in contents.items():
        path = args.destination / ('.env.' + role)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'wb') as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(data)
        print('Prepared ' + role + ' configuration; values were not printed.')


if __name__ == '__main__':
    main()
