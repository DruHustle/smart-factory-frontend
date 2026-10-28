# Factory reference models

Open **Assets & devices → Factory models** to inspect these read-only references. The same catalogue is available to individual engineers when creating local 3D equipment or reviewing a model replacement. The gallery creates no equipment records, observation rows, simulated signals or device connections.

| Model                      | Components | Triangles | GLB bytes | Details                                                                                                       |
| -------------------------- | ---------: | --------: | --------: | ------------------------------------------------------------------------------------------------------------- |
| Belt conveyor              |         33 |     7,318 |   244,956 | Continuous belt, drive/tension drums, bearings, rollers, finned drive and frame                               |
| Six-axis industrial robot  |         46 |    16,394 |   541,000 | Six joint assemblies, bearing/rotor pairs, bolted covers, cast links, continuous service loom and tool flange |
| Industrial control cabinet |         28 |     4,552 |   171,316 | Enclosure, glazed door, DIN rails, PLC, breaker/terminal banks, wiring and cable entries                      |
| Flanged ball valve         |         16 |    10,460 |   306,036 | Hollow body, bored ball, seats, drilled flanges, fasteners, spindle and handwheel                             |
| Stainless process tank     |         26 |     9,372 |   269,588 | Hollow dished vessel, agitator and shaft, access cover, motor, nozzles, supports and ladder                   |

Every model has stable component identities, closed solids, authored explosion/reassembly, ghost/hide controls and section support. Geometry is an original parametric illustration under MIT; proportions and construction are not supplier manufacturing CAD. No operational state, ratings, calibrated measurements or physical motion is inferred.

Reproduce the models with the versions in [requirements-geometry.txt](../../../scripts/equipment/requirements-geometry.txt):

```bash
python scripts/equipment/factory_geometry.py
```

The generator writes each immutable draft package's GLB, template, hash and positive-volume/triangle audit. Validation checks hashes, admission limits, complete scene mappings, cross-model identity separation, closed section contours and absence of invented metric bindings. Native unsigned-16-bit indices reduce delivery bytes without removing any authored triangles.

The authenticated reference-delivery endpoint resolves only the bundled allowlist and uses private/no-store responses. It cannot serve imported/private packages by catalogue slug. Production rollout requires the API/worker capability `factory-reference-models-v1` alongside the matching frontend; the gallery can be tested without a database using the isolated rendering fixture.
