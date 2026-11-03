"""Check printed UI report content from the isolated experience fixture."""
import sys
from pathlib import Path

from pypdf import PdfReader

root = Path(sys.argv[1])
checks = {
    "device.pdf": ["Workspace direct sensor", "23.0", "operational", "Observed source status", "Last seen", "UTC window"],
    "device-unknown.pdf": ["Workspace never configured", "unknown", "Unavailable"],
    "device-stale.pdf": ["Workspace observed offline", "stale", "Last seen"],
    "analytics.pdf": ["Asset Telemetry Report", "Scope: operational", "UTC window"],
    "alerts.pdf": ["Alert History Report", "Alert Details", "UTC window"],
}
for name, required in checks.items():
    text = "\n".join(page.extract_text() or "" for page in PdfReader(root / name).pages)
    for value in required:
        assert value.lower() in text.lower(), f"{name}: missing {value}"
    assert "Print / save as PDF" not in text, f"{name}: print control was printed"
    print(f"{name}: report content verified")
