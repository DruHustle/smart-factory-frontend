-- Acquisition bindings belong to an installed instance, independently of geometry.
ALTER TABLE equipment_workspaces ADD COLUMN bindings jsonb;
