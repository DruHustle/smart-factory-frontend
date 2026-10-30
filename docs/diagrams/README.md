# Generated diagram images

`pnpm docs:pdf` exports the first Mermaid diagram in [architecture](../architecture.md) and [FX/TSN](../fx-tsn.md) as SVG and PNG here, alongside the four PDF guides. Edit the canonical Markdown instead of these generated images.

`docs/pdf-manifest.json` records the source and output SHA-256 hashes. `pnpm docs:check` validates both formats and rejects missing, modified or stale exports. SVG scales for editing/presentations; PNG is suitable for documents and previews. The diagrams describe product boundaries, not measured equipment performance or a commissioned plant.
