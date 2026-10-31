# Smart Factory industrial OpenUSD library

## Included assets and usage

The Factory models page (`/#/models`, linked from Assets & devices) includes three reviewed NVIDIA SimReady references: a transfer conveyor, warehouse storage rack and industrial mobile cart. Existing Smart Factory equipment models remain available.

Selecting a model loads it automatically. Only the selected GLB is fetched. Compact geometry is the default, with detailed geometry available explicitly. Real previews remain visible during loading and when WebGL2 is unavailable. Component selection, focus, hide/isolate, sectioning and illustrative explosion use the existing viewer. Bundled model files must pass SHA-256 verification before parsing. No external model-resource URLs are admitted. No NVIDIA account, runtime API, CUDA installation or GPU server is needed for ordinary browsing.

## Licensing and provenance

Source: https://huggingface.co/datasets/nvidia/simready-assets

The exact dataset revision and package metadata hashes are in `scripts/equipment/openusd/curated.json`. Each selected package separately declares CC-BY-4.0. Acquisition verifies the metadata hash, license declaration, license text, byte size and every Git/LFS file digest before conversion. This approval applies only to the reviewed assets, not all NVIDIA or third-party Omniverse content.

Each public asset directory retains `LICENSE.txt` and `SOURCE.json`. The receipt records source revision, downloaded file hashes, converter, authored object paths and modification limitations. The UI shows NVIDIA attribution, modification disclosure, source and license links. These files and notices must accompany redistribution.

## Operational use

Browsing is read-only. An authorized engineer or administrator can explicitly choose **Add to local models**. This sends the verified GLB and component manifest through the existing authenticated `/api/equipment/model-import` admission path; it does not create an asset or change existing equipment automatically. The API independently validates the content and returns an immutable `local-import:` revision.

**Configure equipment and signals** opens the equipment workflow and selects the imported revision only when it appears in the authorized model catalogue. Create a local instance or choose an existing real acquisition asset and provide explicit source metric bindings. Existing workspace capabilities supply AAS identity, source-quality/freshness handling, saved views, annotations and document relationships. Conversion invents no sensor readings or engineering diagram relationships.

Floor plans, P&IDs and electrical wiring documents remain independently authored and explicitly associated; they are not inferred from the mesh. Visual object names are not a manufacturer-certified bill of materials. Installed models are never silently replaced.

## Conversion limitations

These are static visual references, not validated physical simulations. Native materials/textures are adapted to bounded glTF PBR colors and geometry is decimated. Animation, PhysX properties, robotics articulation and behavior are not transferred. Original USD packages remain the source for a future separately provisioned simulation integration. No Omniverse/Isaac Sim service, autonomous control or simulated physics is enabled by this feature.

Section planes are visual cuts; open meshes are not falsely marked watertight. Exploded spacing is illustrative, not maintenance or engineering instructions.

## Offline rebuild

Use a disposable authoring machine or CI runner, not the production API. Download reviewed sources, then convert without network, secrets or host credentials:

```sh
python3 scripts/equipment/openusd/fetch_sources.py --output /tmp/sf-nvidia-sources
docker build -f scripts/equipment/openusd/Dockerfile -t sf-openusd-authoring .
mkdir -p /tmp/sf-openusd-output/public /tmp/sf-openusd-output/shared
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --memory 5g --cpus 2 --pids-limit 512 \
  --shm-size 256m --tmpfs /tmp:rw,nosuid,nodev,size=512m \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v /tmp/sf-nvidia-sources:/sources:ro \
  -v "$PWD/scripts/equipment/openusd/curated.json:/config/curated.json:ro" \
  -v /tmp/sf-openusd-output:/output:rw \
  sf-openusd-authoring --config /config/curated.json --sources /sources \
  --public-output /output/public \
  --catalog-output /output/shared/industrial-assets.catalog.json
```

The converter accepts local USD, USDA, USDC and bounded USDZ entry points within an approved package. It rejects symlinks, archive traversal/expansion abuse, external GLB resources and unsupported GLB features. It normalizes units/up axis, retains stable component IDs and creates compact/detail GLBs and a CPU-rendered preview. Detailed geometry targets 110,000 triangles; compact targets 30,000, with a 15% margin. Each GLB must fit the existing 20 MiB API admission limit; all six bundled GLBs must fit 40 MiB. Never deploy unvalidated conversion outputs.

For a new asset, review its own license/dependencies, pin its immutable revision and metadata hash, and add its descriptor to `curated.json`. Review visual output, scale, component mapping, provenance and browser performance before inclusion. Geometry hashes can vary between converter/platform versions; checked-in catalogue/files define the deployed immutable revision, not an unreviewed rebuild.

## Qualification

```sh
python3 -m unittest discover -s scripts/equipment/openusd -p 'test_*.py' -v
pnpm check
pnpm exec vitest run server/equipment/openusd.test.ts
pnpm exec playwright install --with-deps chromium firefox webkit
node scripts/equipment/qualify-openusd.mjs
pnpm e2e:equipment --grep NVIDIA
```

The NVIDIA library qualification job validates all six packages through the unchanged API admission contract, licenses/hashes/components/budgets, desktop/mobile rendering, both quality levels, selection, inspection controls, read-only browsing, corrupted/missing files, WebGL-disabled fallback and Firefox/WebKit compatibility. The standalone equipment suite imports a real package through the authenticated API, creates a disposable workspace, reads its local files and persists/reloads a viewpoint. Existing renderer/application regression suites continue to run. CI retains evidence artifacts.

Production uses the existing exact-main-SHA deployment process and API compatibility gate. A successful source test does not establish successful production deployment.
