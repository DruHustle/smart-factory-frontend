# ADR-002: app-owned independent native equipment monitoring

Accepted. Supersedes the earlier rendering-ownership and shared-release proposals.

Smart Factory owns its React view, Three.js renderer, validators, model files, component mappings, backend file delivery, PostgreSQL equipment/work persistence and simulator. No custom Onesa package, schema/SDK release, peer-owned fixture, iframe, remote script, sibling import or peer authentication is required to install, build, start or use native 3D.

Third-party dependencies are independently pinned: Three.js 0.186.1 and @types/three 0.186.0, using the existing React 19.2.3/Vite frontend. Rendering is loaded lazily in the browser through an app-local module. OrbitControls and GLTFLoader ship in the same Three.js package; no second graphics runtime or framework migration is introduced.

The app-specific model/manifest and local API schema are maintained here. A reusable model component ID is distinct from each installed component UUID. Observation bindings use explicit template component IDs. Scene paths and indices are per-revision checks, never equipment identity. Authorized model bytes come from Smart Factory storage. The renderer contains no industrial clients, tenant decisions, credentials or external model-service calls.

Local template setup, optional model import, classified observations/history, notes and viewpoints operate without optional Onesa configuration. Integration readiness and transport/outbox state remain separate from application readiness and graphics updates. Optional connector behavior is described separately; compatibility with an absent consumer API remains pending and is not a local-view prerequisite.

Reference geometry is self-authored and illustrative, covered by this repository's MIT license. It is not dimensional CAD, physics, collision geometry, kinematics or a diagnosis model. AAS serialization and optional exchanges remain backend concerns.

Official library references: https://threejs.org/docs/pages/GLTFLoader.html and https://threejs.org/docs/pages/WebGLRenderer . No canonical/shared-release handoff is required.

The detailed reference remains app-owned reproducible parametric geometry with a selectable BOM. Explosion uses authored local translations/rotations/pivots and immutable baseline matrices. Section caps are derived from actual closed surface intersections, with nested holes and separate connected solids. No consumer service creates hidden geometry. Open/ambiguous sections remain uncapped. Reveal controls and saved views remain available during optional connector outages. Geometry quality and physical-device performance require their own evidence; passing contract tests cannot establish either.
