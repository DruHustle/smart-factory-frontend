"""Copy only source/build/migration files; never package local settings or keys."""
import argparse
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('backend')
parser.add_argument('output')
args = parser.parse_args()
source = Path(args.backend).resolve()
target = Path(args.output).resolve()
if subprocess.check_output(['git','status','--porcelain'],cwd=source,text=True).strip():
    raise SystemExit('Backend source must be clean before creating a release context')
if target.exists():
    raise SystemExit('Output must be a new directory')
for directory in ('src', 'deploy/migrations'):
    for file in (source / directory).rglob('*'):
        if not file.is_file() or any(part in ('bin', 'obj', '.git', 'TestResults') for part in file.parts): continue
        if file.suffix not in ('.cs', '.csproj', '.sln', '.props', '.targets', '.sql'): continue
        destination = target / file.relative_to(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, destination)

for name in ('global.json','deploy/migrations/manifest.json'):
    destination=target/name
    destination.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(source/name,destination)
