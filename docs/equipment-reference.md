# Detailed illustrative reference: source and inspection

The app owns the source and MIT geometry. Rebuild using ordinary, independently installed authoring libraries; none is a runtime peer or custom shared package:

```sh
python3 -m venv /tmp/smart-factory-geometry
/tmp/smart-factory-geometry/bin/pip install -r scripts/equipment/requirements-geometry.txt
/tmp/smart-factory-geometry/bin/python scripts/equipment/generate-artifacts.py
/tmp/smart-factory-geometry/bin/python scripts/equipment/validate-artifacts.py
```

Editable construction is in `scripts/equipment/reference_geometry.py`, with a small local GLB exporter in `geometry_export.py`. Manifold3D 3.5.4 supplies constructive solids and boolean operations. NumPy 2.5.4 supports coordinates; the pinned AAS tools package and independently validate the derivative. Geometry uses metres, right-handed coordinates, +Y up and horizontal X shaft axis. No external texture, environment file, supplier CAD or peer model service is required. Revision 3's asset/template and source are retained; every existing template UUID remains present in revision 4. Private installed models remain immutable until an engineer reviews replacement mappings. Installed IDs, source telemetry, document associations, notes and saved work survive replacement.

`fixtures/equipment/reference-bom.json` distinguishes assemblies, individual parts and repeated selectable sets. `geometry-audit.json` records actual bytes, triangles, model SHA-256, positive-volume manifold checks and measured clearance/continuity results. Counts are inventory, not proof of mechanical correctness. Repeated balls, bars, fins, screws and bundles are combined within their BOM sets, keeping draws bounded without deleting internals. Ordinary glTF meshes retain independent logical selection. No custom compression/instancing extension or runtime authoring tool is required.

| Area | Constructed detail and checks |
| --- | --- |
| Wet end | Spiral collecting void and connected discharge, eccentric shell, real wall thickness; drilled suction cover/backplate and matching through bolts, nuts/washers; field inlet/outlet flanges have actual bores and drilled bolt circles. Curved impeller vanes bridge separate shrouds; hub, shaft opening, gasket and running clearance are geometry. |
| Seal/train | Stepped journals match bearing bores; sleeve, seal chamber/seat support, gland with screws, ceramic stationary seat, rotating carbon face, bellows, helical spring, O rings and collar are separately identifiable. |
| Bearings | Four assemblies, each with bored/grooved inner and outer race, ten solid balls and a two-band bridged cage. Balls have no axial pole holes. Bridges sit between balls. Mesh-tessellation-aware groove allowances and cage clearances are checked. |
| Coupling | Complementary three-jaw hubs and six-lobed spider share the shaft axis; keys and radial retention match hub recesses. Open-bottom guard has shell thickness, drilled mounting flanges, brackets and screws. |
| Motor | Hollow finned housing, saddle-fitting feet, hollow cup end shields with bearing seats, shaft, slotted skew-bar rotor and end rings, stator core/24 teeth and 24 occupied winding slots. Minimum end-ring/stator air gap is checked. Copper runs stay outside rotor, teeth, laminations, housing and shields. End turns lie outside the stack on separated axial planes. |
| Cooling/terminal | Radial fan paddles; actual front grille and sidewall vent slots; hollow terminal box with cable opening, separately removable drilled cover/screws, ceramic board and representative studs/links. |
| Structure | Chamfered drilled baseplate and supports; saddles meet casting surfaces; matching mounting holes, socket/hex heads, washers and contact surfaces. Threads are omitted. |

The declared design is an original illustrative overhung end-suction pump / jaw coupling / TEFC motor. It is not supplier engineering. Existing construction references remain [KSB volutes](https://www.ksb.com/en-global/centrifugal-pump-lexicon/article/volute-casing-pump-1117514), [KSB shaft seals](https://www.ksb.com/en-global/centrifugal-pump-lexicon/article/shaft-seal-1116516) and [SKF bearing construction](https://www.skf.com/binaries/pub12/Images/0901d196807026e8-100-700_SKF_bearings_and_mounted_products_2018_tcm_12-314117.pdf). They inform principles; their CAD/dimensions are not copied or redistributed.

Deliberate scope: the collecting chamber is a stepped spiral approximation with an eccentric shell, without hydraulic analysis. Twelve closed equivalent copper bundles represent a three-phase winding, without turn-by-turn wires, insulating varnish/films or complete phase-lead routing. Terminal links are representative. Thread helices, lubricating galleries, detailed spring seating, fit classes, preload and pressure/electrical/thermal/strength verification are outside this illustrative reference. Boolean union within castings and grouped fastening sets is deliberate; targeted clearance tests do not establish every manufacturing tolerance. No gearbox, reciprocating train, packed gland or external seal-flush system applies. Real equipment requires its approved manufacturer documentation.

The viewer retains actual geometry through animation, immediate scrubbing, saved opacity/visibility, isolation and sectioning. It does not manufacture internals for exterior-only imports. Caps preserve nested bores; source topology distinguishes open geometry, tangent zero-area contact and numerical degeneracy. Software rendering is identified explicitly. Final visual, interaction, performance and independent-startup evidence is in [equipment evidence](equipment-evidence.md).
