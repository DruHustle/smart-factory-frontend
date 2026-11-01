#!/usr/bin/env python3
"""Independently inspect the actual UI downloads; verification dependency only."""
import json
import os
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
os.environ["XDG_CACHE_HOME"] = str(root / "cache")

import ezdxf
from pypdf import PdfReader
results = []
for width in (390, 1440):
    for mode, number in (("process", "PID-UI"), ("electrical", "ELE-UI")):
        path = root / str(width) / mode
        document = ezdxf.readfile(path.with_suffix(".dxf"))
        audit = document.audit()
        assert not audit.errors and not audit.fixes
        assert document.units == 4 and document.dxfversion == "AC1021"
        entities = list(document.modelspace())
        assert not any(e.dxftype() in {"IMAGE", "PDFUNDERLAY", "OLE2FRAME"} for e in entities)
        inserts = list(document.modelspace().query("INSERT"))
        assert len(inserts) == (4 if mode == "process" else 6)
        for insert in inserts:
            attributes = {a.dxf.tag: a.dxf.text for a in insert.attribs}
            assert set(attributes) == {"TAG", "REF", "NAME", "TYPE"}
            assert attributes["REF"] in {"asset:1", "asset:2", "asset:3"}
        reader = PdfReader(path.with_suffix(".pdf"))
        assert len(reader.pages) == 3
        for page in reader.pages:
            assert abs(float(page.mediabox.width) - 420 / 25.4 * 72) < 1
            assert abs(float(page.mediabox.height) - 297 / 25.4 * 72) < 1
            assert not page.images
        text = "\n".join(page.extract_text() for page in reader.pages)
        for required in (number, "Plant Alpha", "Ada Lovelace", "SCHEMATIC - NTS", "NOT FOR CONSTRUCTION", "Connection ID:"):
            assert required in text, required
        results.append({"width": width, "mode": mode, "auditErrors": 0, "auditFixes": 0, "units": "mm", "attributedEquipmentInserts": len(inserts), "vectorA3Pages": len(reader.pages)})
(root / "independent-browser-verification.json").write_text(json.dumps(results, indent=2) + "\n")
print(json.dumps(results, indent=2))
