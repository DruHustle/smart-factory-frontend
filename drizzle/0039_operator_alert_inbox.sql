-- Operators need the same actionable process alerts in their own inbox, without
-- adding unsolicited external email delivery or exposing demo fixtures.
CREATE FUNCTION queue_operator_alert_inbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_kind text;
BEGIN
  IF EXISTS (SELECT 1 FROM devices WHERE id=NEW."deviceId" AND "isDemo"=true)
     OR EXISTS (SELECT 1 FROM assets WHERE "assetId"=NEW."assetId" AND "isDemo"=true)
     OR coalesce(NEW.evidence_snapshot->>'mode','') IN ('simulated','replay') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.severity::text NOT IN ('critical','warning') THEN RETURN NEW; END IF;
    event_kind := 'incident';
  ELSIF NEW.severity::text = 'critical' AND OLD.severity::text <> 'critical' THEN
    event_kind := 'escalation';
  ELSE RETURN NEW;
  END IF;
  INSERT INTO notification_inbox ("alertId", "userId", kind, title, body, "emailStatus")
  SELECT NEW.id, u.id, event_kind,
    CASE event_kind WHEN 'escalation' THEN 'Factory incident escalated: critical' ELSE 'Factory incident: ' || NEW.severity::text END,
    NEW."errorCode" || ' — ' || NEW.message || E'\nEvent #' || NEW.id || CASE WHEN NEW."assetId" IS NULL THEN '' ELSE E'\nAsset: ' || NEW."assetId" END,
    'inbox_only'
  FROM users u
  WHERE u.role::text = 'operator' AND u.disabled_at IS NULL
    AND u.password_change_required=false AND u."openId" NOT LIKE 'demo-%'
    AND lower(coalesce(u.email,'')) NOT IN ('admin@dev.local','operator@dev.local','tech@dev.local','demo@dev.local');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER operator_alert_inbox AFTER INSERT OR UPDATE ON alerts
FOR EACH ROW EXECUTE FUNCTION queue_operator_alert_inbox();
