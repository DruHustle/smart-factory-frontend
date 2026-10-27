# Raspberry Pi 4 Model B illustrative reference

Original, self-authored parametric geometry under the repository MIT licence. The board outline and connector arrangement refer to the [official Raspberry Pi 4 Model B datasheet](https://pip-assets.raspberrypi.com/categories/545-raspberry-pi-4-model-b/documents/RP-008341-DS-1-raspberry-pi-4-datasheet.pdf?disposition=inline). No supplier CAD, photographs, logos or textures are redistributed.

The self-contained GLB has 61 stable selectable entries, 5,406 triangles and 288,440 bytes. Geometry uses metres, right handed coordinates and +Y up. The reference includes the PCB, mounting holes, processor package, memory, wireless shield, GPIO contacts, USB/Ethernet connectors, power/display/ribbon connectors and empty microSD socket. Repeated contact sets carry explicit quantities. Socket shields and board are closed solids for section caps. Housings can be ghosted; assemblies have authored explosion offsets.

This is an illustration. Package exteriors, connector interiors, passives and routing are simplified; silicon internals and a verified circuit layout are not represented. It does not identify an installed gateway board or establish component health. Indicator lenses are unlit. No observations or maintenance instructions are fabricated.

Rebuild with the pinned `manifold3d` and `numpy` versions from `scripts/equipment/requirements-geometry.txt`:

```sh
python scripts/equipment/raspberry_pi_geometry.py
```

`template.json` preserves UUID component identities and exact scene paths/indices. `geometry-audit.json` records byte/hash/triangle counts and positive-volume Manifold3D checks for every solid. The existing pump model and its component IDs are unchanged.

In the application, open **Demo guide → Raspberry Pi gateway**, or find the item under **Assets & devices → 3D equipment**. On a private installation an engineer can select this bundled template when creating local equipment. Source measurements require an explicit compatible mapping; this template has none by default.
