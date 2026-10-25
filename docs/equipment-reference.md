# Detailed illustrative reference: source and inspection

This repository owns the geometry and its MIT redistribution rights. No supplier CAD, peer asset service or model release is used. Rebuild with Python and this app's pinned AAS tooling:

```sh
python3 -m venv /tmp/smart-factory-aas
/tmp/smart-factory-aas/bin/pip install -r scripts/equipment/requirements-aas.txt
/tmp/smart-factory-aas/bin/python scripts/equipment/generate-artifacts.py
```

Editable source: `scripts/equipment/reference_geometry.py`. Viewing derivative: `fixtures/equipment/pump-motor.glb`. Machine-readable inventory: `fixtures/equipment/reference-bom.json`. Per-revision node/identity mappings, rights and coordinates: `fixtures/equipment/local-template.json`. Geometry is in metres, right-handed, +Y up, with a horizontal X shaft axis. The derivative has 76 selectable entries, including groups, approximately 161,000 triangles and a 5.1 MB uncompressed GLB. No external textures are needed. Repeated conductor paths, balls, fins and fastener sets are combined within identified BOM entries. This keeps draw calls bounded while retaining the named critical internals.

The declared design is a single-stage overhung end-suction pump, flexible elastomer coupling and finned TEFC squirrel-cage induction motor. Generic construction was informed by the [KSB volute casing description](https://www.ksb.com/en-global/centrifugal-pump-lexicon/article/volute-casing-pump-1117514), [KSB shaft seal description](https://www.ksb.com/en-global/centrifugal-pump-lexicon/article/shaft-seal-1116516) and [SKF bearing construction reference](https://www.skf.com/binaries/pub12/Images/0901d196807026e8-100-700_SKF_bearings_and_mounted_products_2018_tcm_12-314117.pdf). These explain construction principles; they are not drawings, dimension sources, licenses for copied CAD or evidence of manufacturer accuracy. Source articles are not redistributed.

| Subassembly | Present and separately selectable | Intentionally combined |
| --- | --- | --- |
| Wet end | Hollow volute passage/casing, suction cover/nozzle, discharge neck/flange, back plate, gasket, impeller group | Seven backward-swept vanes; hub/lock nut; casing bolt/washer set |
| Pump train | Stepped shaft, sleeve, bearing carrier, mechanical-seal gland, stationary ceramic seat, rotating carbon face, bellows, spring, O rings | Bearing spacers and end covers |
| Four bearing assemblies | Each bearing's inner race, grooved outer race, rolling-element set and cage | Ten balls per bearing; cage rings/bridges |
| Coupling | Pump hub, motor hub, spider, guard | Spider lobes |
| Motor | Finned housing, shaft, laminated rotor, stator core/teeth, three copper winding phases, DE/NDE shields, cooling fan, fan cover, terminal box, feet | Rotor bars/end rings; each winding phase's bundles/conductors; fins; fan paddles; tie bolts |
| Structure | Baseplate, pump support, mounting fasteners | Feet/support/fastener sets |

No gearbox, reciprocating train, packed gland or external seal-flush system is applicable to this illustrative design. Manufacturer tolerances, approved dimensions, fastener threads, insulation films, detailed electrical connections and lubrication channels are unavailable. Materials are visual approximations. This is not service CAD, a pressure-containing design, hydraulic/electromagnetic simulation or a certified maintenance sequence.

Inspection controls preserve installed UUIDs. The same measurement, note and document bindings follow a component through movement, sectioning and isolation. A source-level unit test repeats explosion/reassembly 100 times and compares baseline matrices to 1e-12. A section test measures a hollow annulus cap area and verifies its bore remains empty. Multiple connected solids are sectioned separately; open/ambiguous contours receive no invented cap. The actual reference must also be reviewed in assembled, exploded, selected-subassembly, sectioned, ghosted and isolated close-up states. Performance measurements identify software WebGL and viewport emulation explicitly; they do not qualify a physical mobile device.

Premium asset acceptance remains subject to the recorded visual review and known limitations in the implementation evidence. Inventory coverage and triangle counts alone do not establish professional CAD fidelity. Customer models retain their own actual completeness; the application never synthesizes purported customer internals.
