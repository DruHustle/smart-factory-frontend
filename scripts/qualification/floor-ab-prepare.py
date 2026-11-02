#!/usr/bin/env python3
"""Give the disposable diagnostic fixture its own Compose namespace."""
import hashlib
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: floor-ab-prepare.py CHECKOUT")
fixture = Path(sys.argv[1]).resolve() / "scripts/experience/e2e.sh"
source = fixture.read_bytes()
if hashlib.sha256(source).hexdigest() != "df4e2580530b74be9e738ab2e3c2c2d769fb97c322fa89c999bbe6783f1639a6":
    raise SystemExit("Unexpected fixture fingerprint")
old = b'-p smart-factory-experience-e2e -f docker-compose.e2e.yml'
new = b'-p "${EXPERIENCE_DIAGNOSTIC_PROJECT:?}" -f docker-compose.e2e.yml'
if source.count(old) != 1:
    raise SystemExit("Unexpected fixture namespace marker")
fixture.write_bytes(source.replace(old, new, 1))
