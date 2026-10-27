CREATE OR REPLACE FUNCTION queue_incident_notifications() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_kind text;
BEGIN
  -- Authored evidence must never enqueue external delivery or notify private operators.
  IF EXISTS(SELECT 1 FROM devices WHERE id=NEW."deviceId" AND "isDemo"=true)
     OR EXISTS(SELECT 1 FROM assets WHERE "assetId"=NEW."assetId" AND "isDemo"=true)
     OR coalesce(NEW.evidence_snapshot->>'mode','') IN ('simulated','replay') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.severity::text NOT IN ('critical', 'warning') THEN RETURN NEW; END IF;
    event_kind := 'incident';
  ELSIF NEW."assignedToId" IS DISTINCT FROM OLD."assignedToId" THEN
    event_kind := 'assignment';
  ELSIF NEW.status::text = 'resolved' AND OLD.status::text <> 'resolved' THEN
    event_kind := 'resolution';
  ELSIF NEW.severity::text = 'critical' AND OLD.severity::text <> 'critical' THEN
    event_kind := 'escalation';
  ELSE RETURN NEW;
  END IF;
  INSERT INTO notification_inbox ("alertId", "userId", kind, title, body)
  SELECT NEW.id, u.id, event_kind,
    CASE event_kind WHEN 'assignment' THEN 'Technician assignment changed' WHEN 'resolution' THEN 'Incident resolved' WHEN 'escalation' THEN 'Factory incident escalated: critical' ELSE 'Factory incident: ' || NEW.severity::text END,
    NEW."errorCode" || ' — ' || NEW.message || E'\nEvent #' || NEW.id || CASE WHEN NEW."assetId" IS NULL THEN '' ELSE E'\nAsset: ' || NEW."assetId" END
  FROM users u WHERE
    (event_kind IN ('incident','escalation') AND u.role::text IN ('admin','engineer')) OR
    (event_kind = 'assignment' AND (u.id = NEW."assignedToId" OR u.id = OLD."assignedToId" OR u.role::text = 'admin')) OR
    (event_kind = 'resolution' AND (u.id = NEW."assignedToId" OR u.role::text = 'admin'));
  RETURN NEW;
END;
$$;
