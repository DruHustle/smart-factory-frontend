CREATE TABLE factories (
 id uuid PRIMARY KEY,
 name varchar(120) NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 width double precision NOT NULL CHECK(width BETWEEN 4 AND 1000),
 depth double precision NOT NULL CHECK(depth BETWEEN 4 AND 1000),
 zones jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(zones)='array'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by integer REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX factories_name ON factories(lower(name));
CREATE INDEX factories_updated ON factories(updated_at DESC,id);

CREATE TABLE factory_items (
 ref varchar(64) PRIMARY KEY,
 factory_id uuid NOT NULL REFERENCES factories(id),
 asset_id integer UNIQUE REFERENCES assets(id) ON DELETE CASCADE,
 device_id integer UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
 origin varchar(16) NOT NULL CHECK(origin IN ('planned','attached')),
 inventory_tag varchar(128) NOT NULL CHECK(length(btrim(inventory_tag)) BETWEEN 1 AND 128),
 inventory_tag_key text GENERATED ALWAYS AS(lower(inventory_tag)) STORED,
 x double precision NOT NULL DEFAULT 0 CHECK(x BETWEEN -1000 AND 1000),
 z double precision NOT NULL DEFAULT 0 CHECK(z BETWEEN -1000 AND 1000),
 rotation double precision NOT NULL DEFAULT 0 CHECK(rotation BETWEEN 0 AND 360),
 zone_id uuid,
 width double precision NOT NULL CHECK(width BETWEEN 0.05 AND 1000),
 depth double precision NOT NULL CHECK(depth BETWEEN 0.05 AND 1000),
 height double precision NOT NULL CHECK(height BETWEEN 0.05 AND 1000),
 CHECK(
  (asset_id IS NOT NULL AND device_id IS NULL AND (ref='asset:'||asset_id OR ref ~ '^equipment:[a-f0-9-]{36}$'))
  OR (device_id IS NOT NULL AND asset_id IS NULL AND ref='device:'||device_id)
 ),
 CONSTRAINT factory_items_tag UNIQUE(factory_id,inventory_tag_key) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX factory_items_factory ON factory_items(factory_id,ref);

CREATE TABLE factory_activity (
 id bigserial PRIMARY KEY,
 factory_id uuid NOT NULL REFERENCES factories(id),
 change_set text NOT NULL,
 actor_id integer,
 actor_name varchar(320) NOT NULL,
 actor_role varchar(32) NOT NULL,
 action varchar(64) NOT NULL,
 target_ref varchar(64),
 before_value jsonb,
 after_value jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX factory_activity_page ON factory_activity(factory_id,id DESC);
CREATE INDEX factory_activity_actor ON factory_activity(factory_id,actor_id,id DESC);

CREATE FUNCTION record_factory_activity(factory uuid, operation text, target text, previous jsonb, next_value jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actor jsonb;
BEGIN
 BEGIN
  actor := nullif(current_setting('smart_factory.actor',true),'')::jsonb;
 EXCEPTION WHEN others THEN
  actor := NULL;
 END;
 INSERT INTO factory_activity(factory_id,change_set,actor_id,actor_name,actor_role,action,target_ref,before_value,after_value)
 VALUES(factory,txid_current()::text,(actor->>'id')::integer,coalesce(nullif(actor->>'name',''),'System'),coalesce(nullif(actor->>'role',''),'system'),operation,target,previous,next_value);
END;
$$;

CREATE FUNCTION protect_factory_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Factory activity is append-only';
END;
$$;
CREATE TRIGGER factory_activity_immutable BEFORE UPDATE OR DELETE ON factory_activity
 FOR EACH ROW EXECUTE FUNCTION protect_factory_activity();

CREATE FUNCTION audit_factory_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; next_value jsonb;
BEGIN
 next_value := jsonb_build_object('name',NEW.name,'width',NEW.width,'depth',NEW.depth,'zones',NEW.zones);
 IF TG_OP='INSERT' THEN
  PERFORM record_factory_activity(NEW.id,'factory.created',NULL,NULL,next_value);
 ELSE
  previous := jsonb_build_object('name',OLD.name,'width',OLD.width,'depth',OLD.depth,'zones',OLD.zones);
  IF previous IS DISTINCT FROM next_value THEN
   PERFORM record_factory_activity(NEW.id,'factory.updated',NULL,previous,next_value);
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE FUNCTION version_factory_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.name,NEW.width,NEW.depth,NEW.zones) IS DISTINCT FROM ROW(OLD.name,OLD.width,OLD.depth,OLD.zones) THEN
  NEW.version := OLD.version+1;
 END IF;
 NEW.updated_at := clock_timestamp();
 RETURN NEW;
END;
$$;
CREATE TRIGGER factory_definition_version BEFORE UPDATE ON factories
 FOR EACH ROW EXECUTE FUNCTION version_factory_definition();
CREATE TRIGGER factory_definition_activity AFTER INSERT OR UPDATE ON factories
 FOR EACH ROW EXECUTE FUNCTION audit_factory_definition();

CREATE FUNCTION audit_factory_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; next_value jsonb; factory uuid; target text; operation text; item_name text;
BEGIN
 IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN factory:=OLD.factory_id; target:=OLD.ref;
 ELSE factory:=NEW.factory_id; target:=NEW.ref; END IF;
 SELECT coalesce(a.name,d.name) INTO item_name FROM factory_items fi
 LEFT JOIN assets a ON a.id=fi.asset_id LEFT JOIN devices d ON d.id=fi.device_id WHERE fi.ref=target;
 IF TG_OP<>'INSERT' THEN
  previous:=jsonb_build_object('ref',OLD.ref,'tag',OLD.inventory_tag,'name',item_name,'x',OLD.x,'z',OLD.z,'rotation',OLD.rotation,'zoneId',OLD.zone_id,'width',OLD.width,'depth',OLD.depth,'height',OLD.height);
 END IF;
 IF TG_OP<>'DELETE' THEN
  next_value:=jsonb_build_object('ref',NEW.ref,'tag',NEW.inventory_tag,'name',item_name,'x',NEW.x,'z',NEW.z,'rotation',NEW.rotation,'zoneId',NEW.zone_id,'width',NEW.width,'depth',NEW.depth,'height',NEW.height);
 END IF;
 operation:=CASE WHEN TG_OP='INSERT' AND NEW.origin='planned' THEN 'inventory.created'
  WHEN TG_OP='INSERT' THEN 'inventory.attached'
  WHEN TG_OP='UPDATE' THEN 'placement.changed' ELSE 'floor.item_removed' END;
 PERFORM record_factory_activity(factory,operation,target,previous,next_value);
 UPDATE factories SET version=version+1 WHERE id=factory;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER factory_item_activity AFTER INSERT OR UPDATE OR DELETE ON factory_items
 FOR EACH ROW EXECUTE FUNCTION audit_factory_item();

CREATE FUNCTION audit_factory_inventory_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member record; previous jsonb; next_value jsonb; old_record jsonb; new_record jsonb; safe_keys text[]; metadata_keys jsonb;
BEGIN
 IF TG_TABLE_NAME='assets' THEN
  SELECT * INTO member FROM factory_items WHERE asset_id=OLD.id;
  safe_keys:=ARRAY['name','assetId','assetType','manufacturer','model','manufacturerStreet','manufacturerZipcode','manufacturerCityTown','manufacturerNationalCode','manufacturerArticleNumber','orderCodeOfManufacturer','ratedValue','ratedUnit','serialNumber','location','zone','lifecycleStage','aasVersion','isDemo'];
 ELSE
  SELECT * INTO member FROM factory_items WHERE device_id=OLD.id;
  safe_keys:=ARRAY['name','deviceId','type','location','zone','firmwareVersion','status','isDemo'];
 END IF;
 IF NOT FOUND THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 old_record:=to_jsonb(OLD);
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO previous FROM jsonb_each(old_record) WHERE key=ANY(safe_keys);
 IF TG_OP='DELETE' THEN
  previous:=previous||jsonb_build_object('ref',member.ref,'tag',member.inventory_tag,'x',member.x,'z',member.z,'rotation',member.rotation,'width',member.width,'depth',member.depth,'height',member.height);
  PERFORM record_factory_activity(member.factory_id,'inventory.deleted',member.ref,previous,NULL);
  RETURN OLD;
 END IF;
 new_record:=to_jsonb(NEW);
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO next_value FROM jsonb_each(new_record) WHERE key=ANY(safe_keys);
 -- Connection-setting values can contain credentials. Retain changed keys, never their secret values.
 IF TG_TABLE_NAME='devices' AND old_record->'metadata' IS DISTINCT FROM new_record->'metadata' THEN
  SELECT coalesce(jsonb_agg(key ORDER BY key),'[]') INTO metadata_keys FROM (
   SELECT key FROM jsonb_each(CASE WHEN jsonb_typeof(old_record->'metadata')='object' THEN old_record->'metadata' ELSE '{}'::jsonb END)
   UNION SELECT key FROM jsonb_each(CASE WHEN jsonb_typeof(new_record->'metadata')='object' THEN new_record->'metadata' ELSE '{}'::jsonb END)
  ) k WHERE old_record->'metadata'->key IS DISTINCT FROM new_record->'metadata'->key;
  previous:=previous||jsonb_build_object('configurationChanged',true,'configurationKeys',metadata_keys);
  next_value:=next_value||jsonb_build_object('configurationChanged',true,'configurationKeys',metadata_keys);
 END IF;
 IF previous IS DISTINCT FROM next_value OR metadata_keys IS NOT NULL THEN
  PERFORM record_factory_activity(member.factory_id,'inventory.updated',member.ref,previous,next_value);
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER factory_asset_inventory_activity BEFORE UPDATE OR DELETE ON assets
 FOR EACH ROW EXECUTE FUNCTION audit_factory_inventory_record();
CREATE TRIGGER factory_device_inventory_activity BEFORE UPDATE OR DELETE ON devices
 FOR EACH ROW EXECUTE FUNCTION audit_factory_inventory_record();

-- Links are factory changes too; acquisition timestamps are observations, not configuration edits.
CREATE FUNCTION audit_factory_connection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; next_value jsonb; old_record jsonb; new_record jsonb; member record; changed_fields jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN old_record:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN new_record:=to_jsonb(NEW); END IF;
 IF TG_OP='UPDATE' AND ROW(OLD."assetId",OLD."deviceId",OLD.protocol,OLD.endpoint,OLD."tagMappings"::text)
  IS NOT DISTINCT FROM ROW(NEW."assetId",NEW."deviceId",NEW.protocol,NEW.endpoint,NEW."tagMappings"::text) THEN RETURN NEW; END IF;
 SELECT jsonb_agg(key ORDER BY key) INTO changed_fields FROM (VALUES('assetId'),('deviceId'),('protocol'),('endpoint'),('tagMappings')) v(key)
 WHERE old_record->key IS DISTINCT FROM new_record->key;
 IF old_record IS NOT NULL THEN
  previous:=jsonb_build_object('assetRef','asset:'||(old_record->>'assetId'),'deviceRef','device:'||(old_record->>'deviceId'),'protocol',old_record->>'protocol','endpointConfigured',coalesce(old_record->>'endpoint','')<>'','mappingCount',CASE WHEN jsonb_typeof(old_record->'tagMappings')='array' THEN jsonb_array_length(old_record->'tagMappings') ELSE 0 END,'changedFields',changed_fields);
 END IF;
 IF new_record IS NOT NULL THEN
  next_value:=jsonb_build_object('assetRef','asset:'||(new_record->>'assetId'),'deviceRef','device:'||(new_record->>'deviceId'),'protocol',new_record->>'protocol','endpointConfigured',coalesce(new_record->>'endpoint','')<>'','mappingCount',CASE WHEN jsonb_typeof(new_record->'tagMappings')='array' THEN jsonb_array_length(new_record->'tagMappings') ELSE 0 END,'changedFields',changed_fields);
 END IF;
 FOR member IN SELECT factory_id,ref FROM factory_items
  WHERE asset_id IN ((old_record->>'assetId')::integer,(new_record->>'assetId')::integer)
     OR device_id IN ((old_record->>'deviceId')::integer,(new_record->>'deviceId')::integer)
 LOOP
  PERFORM record_factory_activity(member.factory_id,CASE TG_OP WHEN 'INSERT' THEN 'connection.added' WHEN 'DELETE' THEN 'connection.removed' ELSE 'connection.updated' END,member.ref,previous,next_value);
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER factory_connection_activity AFTER INSERT OR UPDATE OR DELETE ON asset_devices
 FOR EACH ROW EXECUTE FUNCTION audit_factory_connection();

-- Saved workflows associated with a factory belong in the same attributed history.
-- Projections deliberately exclude documents, endpoints, artifact URLs and free-text secrets.
CREATE FUNCTION audit_factory_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior_row jsonb; next_row jsonb; previous jsonb; next_value jsonb; sample jsonb; safe_keys text[]; asset_pk integer; device_pk integer; member record;
BEGIN
 IF TG_OP<>'INSERT' THEN prior_row:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN next_row:=to_jsonb(NEW); END IF;
 sample:=coalesce(next_row,prior_row);
 CASE TG_TABLE_NAME
 WHEN 'alert_thresholds' THEN
  device_pk:=(sample->>'deviceId')::integer;
  safe_keys:=ARRAY['id','deviceId','metric','unit','minValue','maxValue','warningMin','warningMax','enabled'];
 WHEN 'alerts' THEN
  device_pk:=(sample->>'deviceId')::integer;
  SELECT id INTO asset_pk FROM assets WHERE "assetId"=sample->>'assetId';
  safe_keys:=ARRAY['id','deviceId','assetId','type','severity','errorCode','status','assignedToId','assignedAt','downtimeStartedAt','acknowledgedBy','acknowledgedAt','resolvedById','resolvedAt'];
 WHEN 'ota_deployments' THEN
  device_pk:=(sample->>'deviceId')::integer;
  safe_keys:=ARRAY['id','deviceId','firmwareVersionId','previousVersion','status','startedAt','completedAt'];
 WHEN 'equipment_workspaces' THEN
  asset_pk:=(sample->>'asset_id')::integer;
  safe_keys:=ARRAY['id','asset_id','template_revision','kind','is_standalone','is_demo','source_device_id','version'];
 WHEN 'equipment_scenario_runs' THEN
  SELECT asset_id INTO asset_pk FROM equipment_workspaces WHERE id=(sample->>'equipment_id')::uuid;
  safe_keys:=ARRAY['id','equipment_id','scenario','started_at'];
 WHEN 'asset_passport_publications' THEN
  asset_pk:=(sample->>'asset_id')::integer;
  safe_keys:=ARRAY['id','asset_id','published_by','published_at','revoked_at'];
 ELSE RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 END CASE;
 IF prior_row IS NOT NULL THEN SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO previous FROM jsonb_each(prior_row) WHERE key=ANY(safe_keys); END IF;
 IF next_row IS NOT NULL THEN SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO next_value FROM jsonb_each(next_row) WHERE key=ANY(safe_keys); END IF;
 IF previous IS NOT DISTINCT FROM next_value THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 FOR member IN SELECT DISTINCT fi.factory_id,fi.ref FROM factory_items fi
  WHERE fi.asset_id=asset_pk OR fi.device_id=device_pk OR fi.asset_id IN (SELECT "assetId" FROM asset_devices WHERE "deviceId"=device_pk)
 LOOP
  PERFORM record_factory_activity(member.factory_id,TG_TABLE_NAME||'.'||lower(TG_OP),member.ref,previous,next_value);
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER factory_threshold_activity AFTER INSERT OR UPDATE OR DELETE ON alert_thresholds FOR EACH ROW EXECUTE FUNCTION audit_factory_workflow();
CREATE TRIGGER factory_incident_activity AFTER INSERT OR UPDATE OR DELETE ON alerts FOR EACH ROW EXECUTE FUNCTION audit_factory_workflow();
CREATE TRIGGER factory_ota_activity AFTER INSERT OR UPDATE OR DELETE ON ota_deployments FOR EACH ROW EXECUTE FUNCTION audit_factory_workflow();
CREATE TRIGGER factory_equipment_activity AFTER INSERT OR UPDATE OR DELETE ON equipment_workspaces FOR EACH ROW EXECUTE FUNCTION audit_factory_workflow();
CREATE TRIGGER factory_scenario_activity AFTER INSERT OR UPDATE OR DELETE ON equipment_scenario_runs FOR EACH ROW EXECUTE FUNCTION audit_factory_workflow();
CREATE TRIGGER factory_passport_activity AFTER INSERT OR UPDATE OR DELETE ON asset_passport_publications FOR EACH ROW EXECUTE FUNCTION audit_factory_workflow();
