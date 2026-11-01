# Original Blender equipment references

The model library includes three original MIT-licensed references: a sectional loading door, an industrial personnel door, and a process transmitter. They replace the corresponding simple floor proxies where a reviewed model is available; a failed load retains the existing proxy. Existing equipment and NVIDIA model identities remain unchanged.

The selection reviewed all 2,679 root entries of NVIDIA's `nvidia/simready-assets` catalog at revision `4763fbfaa4f8e97658e68b57d01b4c86659e08b5`. The pinned catalog contains compressors, so none were duplicated. No suitable sectional loading door, personnel door or process transmitter was identified. Vehicle doors, a locker, a dock gate, medical pressure monitors and handheld service gauges are different reference types. [Selection receipt](../scripts/equipment/blender-gap-selection.json) records the search and inventory hash. This is a scoped catalog review, not a claim about every NVIDIA product.

The original source is [blender_gap_assets.py](../scripts/equipment/blender_gap_assets.py), authored for **Blender 4.5.10 LTS**. Its bevels, weighted normals, panel joints, seals, hardware, ports and readable neutral markings provide the manufacturing detail missing from the previous proxies. Materials separate powder coat and polymers from exposed steel/brass, using bounded metallic/roughness factors compatible with the same browser PBR lighting as the NVIDIA references. No downloaded geometry, images or host fonts are used. GLBs make no external requests.

From the frontend repository, reproduce the complete checked-in catalog with a pinned Blender binary (quote its path):

```sh
BLENDER='/absolute/path/to/Blender.app/Contents/MacOS/Blender'
"$BLENDER" --background --factory-startup --threads 4 \
  --python scripts/equipment/blender_gap_assets.py -- \
  --evidence-dir '/absolute/path/to/local-tools/deployment-evidence/blender/source-scenes'
pnpm exec vitest run server/equipment/authored-assets.test.ts \
  server/equipment/openusd.test.ts server/equipment/industrial-release.test.ts \
  server/equipment/factory-models.test.ts
pnpm check
```

The optional evidence directory receives editable detailed `.blend` scenes with the preview studio. The committed Python source is the reproducible editable source for both quality levels. `--output-root '/absolute/path/to/output'` supports isolated regeneration; the output directory must contain a `shared` directory. Run all three models when replacing the catalog. Existing hashed files are retained by the generator so it cannot silently destroy a published revision; remove unreferenced intermediate exports only after checking catalog and release references.

Each public model directory contains `compact.<hash>.glb`, `detail.<hash>.glb`, a **real Cycles render** (`preview.png`), `SOURCE.json` and `LICENSE.txt`. The receipt records generator SHA256, Blender version, bounds, GLB hashes/size/triangles and preview hash. The generated [authored catalog](../shared/authored-assets.catalog.json) is separate from the unchanged NVIDIA attribution catalog. Compact/detail preserve semantic component UUIDs, node paths, selection and explode vectors. All are authored in metres with floor Z=0 in Blender; the exporter converts to the application's +Y-up convention and tests check actual loaded bounds.

The gallery exposes both quality levels. Floor and native reference APIs use compact packages, with the same server SHA256 validation and authentication as existing references. The image build stages only the three hash-verified compact GLBs and their MIT licenses/source receipts into the native runtime; detailed GLBs and preview images remain in the frontend static deployment. Staging rejects missing/corrupt files, unsafe paths and mismatched provenance before copying anything. Bundled browser delivery accepts only catalog paths and verifies size and SHA256 before rendering. Deployment verification checks all twelve NVIDIA/authored GLBs plus previews, licenses and source receipts byte-for-byte from the exact release checkout.

Creating equipment from a native authored selector, or confirming a reviewed replacement with one, stores the immutable model through the existing database-backed `local-import:` format. This preserves the complete manifest, bytes and stable installed component IDs when running a compatible older image that does not recognize the new authored selector. Reusing the same package does not consume more storage quota. Stateless floor references can fall back to the existing proxy on that older image. The packaged smoke test exercises authenticated native routes and exact hashes, then creates all three authored equipment instances and reads their bytes and components through candidate → fallback → candidate. This coverage is separate from the gallery's local browser fixture.

These assets are illustrative visual references. They are not manufacturer CAD, measured installed equipment, a certified fire/escape door, or NVIDIA SimReady-certified assets. No articulation, collision or engineering solidity is asserted. Visual section cuts remain uncapped surfaces. The transmitter display is deliberately blank; it cannot imply an unrecorded measurement or operating condition. Instrument telemetry remains separately bound to recorded sources.
