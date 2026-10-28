#!/usr/bin/env python3
"""Scan a local image; download public databases without uploading application data."""
import argparse
import hashlib
import os
from pathlib import Path
import platform
import subprocess
import tarfile
import tempfile
import urllib.request

VERSION = '0.75.0'
RELEASES = {
    ('Linux', 'aarch64'): ('Linux-ARM64', 'a1ee9f6ffb7d112b64ff726a2a0717c21175c1114361391f4a132956751a13b3'),
    ('Linux', 'x86_64'): ('Linux-64bit', 'c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f'),
    ('Darwin', 'arm64'): ('macOS-ARM64', '4a77108cccf8e55c8d6823e1e759939a622277e66cd0daa3c1fc621ed69e4568'),
}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', nargs='?', default='smart-factory-render-review:local')
    parser.add_argument('--output', default='container-audit.json')
    args = parser.parse_args()
    release = RELEASES.get((platform.system(), platform.machine()))
    if not release:
        parser.error('The pinned scanner supports Linux x86_64/arm64 and macOS arm64')
    with tempfile.TemporaryDirectory(prefix='factory-trivy-') as temporary:
        root = Path(temporary)
        archive = root / 'trivy.tar.gz'
        target, expected = release
        url = f'https://github.com/aquasecurity/trivy/releases/download/v{VERSION}/trivy_{VERSION}_{target}.tar.gz'
        with urllib.request.urlopen(url, timeout=60) as source, archive.open('wb') as destination:
            while chunk := source.read(1024 * 1024):
                destination.write(chunk)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
            raise RuntimeError('Scanner release checksum mismatch')
        executable = root / 'trivy'
        with tarfile.open(archive) as packed:
            entry = packed.getmember('trivy')
            if not entry.isfile():
                raise RuntimeError('Scanner binary is not a regular file')
            executable.write_bytes(packed.extractfile(entry).read())
        executable.chmod(0o700)
        configuration = root / 'no-config.yaml'
        configuration.write_text('{}\n')
        ignore = root / 'no-ignores'
        ignore.write_text('')
        # Do not accept a remote scanner/server or infer a registry image source.
        # Inherit only the process/system and local Docker connection settings.
        keys = ('PATH', 'HOME', 'TMPDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
                'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')
        environment = {key: os.environ[key] for key in keys if key in os.environ}
        return subprocess.run([str(executable), 'image', '--disable-telemetry', '--image-src', 'docker',
            '--scanners', 'vuln', '--severity', 'HIGH,CRITICAL', '--exit-code', '1',
            '--format', 'json', '--output', args.output, '--cache-dir', str(root / 'cache'),
            '--config', str(configuration), '--ignorefile', str(ignore),
            args.image], env=environment, check=False).returncode

if __name__ == '__main__':
    raise SystemExit(main())
