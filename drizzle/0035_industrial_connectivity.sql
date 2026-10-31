CREATE TABLE industrial_gateway_configurations (
 gateway_id integer PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991),
 configuration jsonb,
 published_configuration jsonb,
 pending_publication jsonb,
 published_revision bigint,
 published_at timestamptz,
 reported_revision bigint,
 last_received_at timestamptz,
 last_error varchar(128),
 pending_probe jsonb,
 probe_result jsonb,
 updated_by integer REFERENCES users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(configuration IS NULL OR octet_length(configuration::text)<=131072),
 CHECK(published_configuration IS NULL OR octet_length(published_configuration::text)<=131072)
);
CREATE TABLE industrial_connection_latest (
 gateway_id integer NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 connection_id varchar(64) NOT NULL,
 revision bigint NOT NULL,
 observed_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 report jsonb NOT NULL,
 PRIMARY KEY(gateway_id,connection_id)
);
CREATE TABLE industrial_tag_latest (
 gateway_id integer NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 connection_id varchar(64) NOT NULL,
 tag_id varchar(64) NOT NULL,
 revision bigint NOT NULL,
 observed_at timestamptz NOT NULL,
 current_eligible boolean NOT NULL,
 report jsonb NOT NULL,
 PRIMARY KEY(gateway_id,connection_id,tag_id)
);
CREATE TABLE industrial_observation_history (
 gateway_id integer NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 event_id uuid NOT NULL,
 connection_id varchar(64) NOT NULL,
 revision bigint NOT NULL,
 observed_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 current_eligible boolean NOT NULL,
 report jsonb NOT NULL CHECK(octet_length(report::text)<=32768),
 PRIMARY KEY(gateway_id,event_id)
);
CREATE INDEX industrial_history_recent ON industrial_observation_history(gateway_id,observed_at DESC,event_id);
CREATE TABLE industrial_configuration_activity (
 id bigserial PRIMARY KEY,
 gateway_device_id varchar(64) NOT NULL,
 revision bigint NOT NULL,
 actor jsonb NOT NULL,
 configuration jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX industrial_configuration_history ON industrial_configuration_activity(gateway_device_id,id DESC);
CREATE FUNCTION audit_industrial_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_value jsonb; gateway_identity varchar(64); factory uuid;
BEGIN
 IF NEW.configuration IS NOT NULL AND (TG_OP='INSERT' OR OLD.configuration IS DISTINCT FROM NEW.configuration) THEN
  actor_value := coalesce(nullif(current_setting('smart_factory.actor',true),'')::jsonb,'{"role":"system"}'::jsonb);
  SELECT "deviceId" INTO gateway_identity FROM devices WHERE id=NEW.gateway_id;
  INSERT INTO industrial_configuration_activity(gateway_device_id,revision,actor,configuration) VALUES(gateway_identity,NEW.revision,actor_value,NEW.configuration);
  SELECT factory_id INTO factory FROM factory_items WHERE device_id=NEW.gateway_id;
  IF factory IS NOT NULL THEN
   PERFORM record_factory_activity(factory,'connectivity.configured','device:'||NEW.gateway_id,NULL,jsonb_build_object('revision',NEW.revision,'connectionCount',jsonb_array_length(NEW.configuration->'connections')));
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER industrial_configuration_audit AFTER INSERT OR UPDATE ON industrial_gateway_configurations FOR EACH ROW EXECUTE FUNCTION audit_industrial_configuration();
CREATE TRIGGER industrial_configuration_activity_immutable BEFORE UPDATE OR DELETE ON industrial_configuration_activity FOR EACH ROW EXECUTE FUNCTION protect_factory_activity();
