-- Explicit origin; do not infer physical identity from names, IDs or location.
-- Legacy workspaces retain their authoritative asset as their canonical inventory row.
ALTER TABLE equipment_workspaces ADD COLUMN is_standalone boolean NOT NULL DEFAULT false;
