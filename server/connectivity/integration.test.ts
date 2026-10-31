import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { appRouter } from "../routers";
import { createUser, getDb, closeDatabase, type User } from "../db";
import { registerDevice } from "../deviceRegistration";
import { ingestTelemetryByDeviceId } from "../ingestion";
import type { TrpcContext } from "../_core/context";
import type {
  ConnectivityObservation,
  IndustrialConnection,
} from "../../shared/industrial-connectivity";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "Industrial connectivity transactional workflow",
  () => {
    const suffix = crypto.randomUUID().slice(0, 8),
      gatewayId = `connectivity-${suffix}`;
    let engineer: User, viewer: User, deviceId: number, assetId: number;
    const assetIdentity = `urn:connectivity:asset:${suffix}`;
    const caller = (user: User) =>
      appRouter.createCaller({
        user,
        req: { headers: { cookie: "smart_factory_data_workspace=live" } },
        res: {},
        visibility: Promise.resolve({ demoOnly: false, includeDemo: false }),
      } as unknown as TrpcContext);
    const connection: IndustrialConnection = {
      connectionId: "pump",
      name: "Pump",
      protocol: "modbus_tcp",
      endpoint: "tcp://127.0.0.1:1502",
      enabled: true,
      intervalMs: 1000,
      tags: [
        {
          tagId: "inlet",
          name: "Inlet pressure",
          dataType: "float32",
          unit: "bar",
          assetId: assetIdentity,
          property: "inletPressure",
          source: {
            address: 100,
            count: 2,
            registerType: "holding_register",
            unitId: 1,
          },
        },
        {
          tagId: "outlet",
          name: "Outlet pressure",
          dataType: "float32",
          unit: "bar",
          assetId: assetIdentity,
          property: "outletPressure",
          source: {
            address: 102,
            count: 2,
            registerType: "holding_register",
            unitId: 1,
          },
        },
      ],
    };
    function report(tagId = "inlet", value = 2.1): ConnectivityObservation {
      return {
        schemaVersion: "industrial-observation/v1",
        connectionId: "pump",
        configurationRevision: 1,
        eventId: crypto.randomUUID(),
        observedAt: new Date().toISOString(),
        state: "connected",
        tags: [
          {
            tagId,
            dataType: "float32",
            value,
            unit: "bar",
            quality: "good",
            qualityBasis: "communication",
          },
        ],
      };
    }
    async function ingest(observation: ConnectivityObservation, extra = {}) {
      return ingestTelemetryByDeviceId({
        deviceId: gatewayId,
        gatewayId,
        timestamp: Date.parse(observation.observedAt),
        transportRetained: false,
        transportRetainVerified: true,
        integration: {
          mode: "live",
          sourceQuality: "good",
          sourceConnection: "online",
          timestampOrigin: "gateway",
          gatewayReceivedAt: observation.observedAt,
          retained: false,
        },
        connectivity: observation,
        ...extra,
      });
    }
    beforeAll(async () => {
      vi.stubEnv("PUBLIC_DEMO_DEPLOYMENT", "false");
      vi.stubEnv(
        "AAS_PROVISIONING_API_URL",
        "http://127.0.0.1:3102/api/assets",
      );
      vi.stubEnv(
        "AAS_PROVISIONING_TOKEN",
        "connectivity-test-service-token-000000000",
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ published: true }), { status: 200 }),
        ),
      );
      engineer = (await createUser({
        openId: `connectivity-engineer-${suffix}`,
        email: `engineer-${suffix}@example.test`,
        name: "Connectivity engineer",
        role: "engineer",
      }))!;
      viewer = (await createUser({
        openId: `connectivity-viewer-${suffix}`,
        email: `viewer-${suffix}@example.test`,
        role: "viewer",
      }))!;
      const d = await registerDevice(
        {
          type: "gateway",
          deviceId: gatewayId,
          name: "Connectivity test gateway",
          route: "direct",
          legacyUnits: {},
        },
        engineer.id,
      );
      deviceId = d.id;
      const db = (await getDb())!;
      const [asset] = await db.execute<{ id: number }>(
        sql`insert into assets("assetId",name,"assetType","aasShell") values(${assetIdentity},'Connectivity pump','pump','{}'::json) returning id`,
      );
      assetId = asset.id;
      await db.execute(
        sql`insert into asset_devices("assetId","deviceId",protocol) values(${assetId},${deviceId},'mqtt')`,
      );
    });
    afterAll(async () => {
      const db = await getDb();
      if (db && deviceId) {
        await db.execute(
          sql`delete from asset_devices where "deviceId"=${deviceId}`,
        );
        await db.execute(sql`delete from devices where id=${deviceId}`);
      }
      if (db && assetId)
        await db.execute(sql`delete from assets where id=${assetId}`);
      if (db && engineer && viewer)
        await db.execute(
          sql`delete from users where id in (${engineer.id},${viewer.id})`,
        );
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      await closeDatabase();
    });
    it("protects configuration and rejects an asset outside the gateway's commissioned links", async () => {
      await expect(
        caller(viewer).connectivity.save({
          gatewayDeviceId: gatewayId,
          expectedRevision: 0,
          connections: [connection],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const foreign = structuredClone(connection);
      foreign.tags[0].assetId = "urn:foreign:asset";
      await expect(
        caller(engineer).connectivity.save({
          gatewayDeviceId: gatewayId,
          expectedRevision: 0,
          connections: [foreign],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
    it("saves a revision with its actor, rejects stale edits and distinguishes sending from applying", async () => {
      expect(
        await caller(engineer).connectivity.save({
          gatewayDeviceId: gatewayId,
          expectedRevision: 0,
          connections: [connection],
        }),
      ).toEqual({ saved: true, revision: 1 });
      await expect(
        caller(engineer).connectivity.save({
          gatewayDeviceId: gatewayId,
          expectedRevision: 0,
          connections: [connection],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      let state = await caller(viewer).connectivity.get({
        gatewayDeviceId: gatewayId,
      });
      expect(state.publishedRevision).toBeNull();
      expect(state.reportedRevision).toBeNull();
      expect(state.observations).toHaveLength(0);
      await expect(ingest(report())).rejects.toMatchObject({
        code: "connectivity_revision_mismatch",
      });
      expect(
        (
          await caller(engineer).connectivity.publish({
            gatewayDeviceId: gatewayId,
            expectedRevision: 1,
          })
        ).published,
      ).toBe(true);
      state = await caller(viewer).connectivity.get({
        gatewayDeviceId: gatewayId,
      });
      expect(state.publishedRevision).toBe(1);
      expect(state.reportedRevision).toBeNull();
      const [activity] = await (await getDb())!.execute<{
        actor: { id: number };
        revision: string;
      }>(
        sql`select actor,revision from industrial_configuration_activity where gateway_device_id=${gatewayId} order by id desc limit 1`,
      );
      expect(activity.actor.id).toBe(engineer.id);
    });
    it("records the explicit gateway receipt without inventing a connected device", async () => {
      await ingest({
        ...report(),
        connectionId: "gateway-configuration",
        state: "waiting",
        tags: [],
      });
      const state = await caller(viewer).connectivity.get({
        gatewayDeviceId: gatewayId,
      });
      expect(state.reportedRevision).toBe(1);
      expect(state.observations).toHaveLength(0);
    });
    it("preserves different pressure tags across batches, deduplicates events and keeps history", async () => {
      const inlet = report("inlet", 2.1),
        outlet = report("outlet", 5.7);
      await ingest(inlet);
      await ingest(outlet);
      expect(await ingest(inlet)).toMatchObject({ duplicate: true });
      const state = await caller(viewer).connectivity.get({
        gatewayDeviceId: gatewayId,
      });
      const values = Object.fromEntries(
        state.observations.flatMap((o) =>
          o.tags.map((t) => [t.tagId, t.value]),
        ),
      );
      expect(values).toEqual({ inlet: 2.1, outlet: 5.7 });
      const history = await caller(viewer).connectivity.history({
        gatewayDeviceId: gatewayId,
        connectionId: "pump",
        tagId: "inlet",
        limit: 50,
      });
      expect(history).toHaveLength(1);
      expect(history[0].value).toBe(2.1);
      await expect(
        ingest({ ...inlet, tags: [{ ...inlet.tags[0], value: 9 }] }),
      ).rejects.toMatchObject({ code: "connectivity_event_identity_conflict" });
    });
    it("rejects unknown tags and wrong revisions, and cannot promote retained history to current values", async () => {
      await expect(ingest(report("unknown"))).rejects.toMatchObject({
        code: "connectivity_tag_mismatch",
      });
      await expect(
        ingest({ ...report(), configurationRevision: 42 }),
      ).rejects.toMatchObject({ code: "connectivity_revision_mismatch" });
      await ingest(report("inlet", 99), { transportRetained: true });
      const state = await caller(viewer).connectivity.get({
        gatewayDeviceId: gatewayId,
      });
      expect(
        state.observations
          .flatMap((o) => o.tags)
          .find((t) => t.tagId === "inlet")?.value,
      ).toBe(2.1);
    });
    it("correlates a read-only probe result with its exact unsaved connection and command", async () => {
      const unsaved = { ...connection, connectionId: "probe-pump", tags: [] };
      const command = await caller(engineer).connectivity.probe({
        gatewayDeviceId: gatewayId,
        expectedRevision: 1,
        connection: unsaved,
      });
      expect(command.published).toBe(true);
      await expect(
        caller(engineer).connectivity.probe({
          gatewayDeviceId: gatewayId,
          expectedRevision: 1,
          connection: unsaved,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const response = {
        ...report(),
        connectionId: "probe-pump",
        commandId: command.commandId,
        tags: [],
      };
      await ingest(response);
      const state = await caller(viewer).connectivity.get({
        gatewayDeviceId: gatewayId,
      });
      expect(state.probe).toMatchObject({
        commandId: command.commandId,
        status: "completed",
      });
      expect(state.configuration?.connections).toHaveLength(1);
      await expect(
        ingest({ ...response, commandId: crypto.randomUUID() }),
      ).rejects.toMatchObject({ code: "connectivity_probe_mismatch" });
    });
    it("keeps the published acquisition and explicit asset mapping active while a new draft is saved", async () => {
      const before = await caller(viewer).connectivity.get({
        gatewayDeviceId: gatewayId,
      });
      await caller(engineer).connectivity.save({
        gatewayDeviceId: gatewayId,
        expectedRevision: 1,
        connections: [],
      });
      await ingest(report("inlet", 2.8));
      const state = await caller(viewer).connectivity.get({
        gatewayDeviceId: gatewayId,
      });
      expect(state.revision).toBe(2);
      expect(state.configuration?.connections).toEqual([]);
      expect(state.activeConfiguration?.revision).toBe(1);
      expect(state.observations.length).toBeGreaterThan(0);
      const tags = await caller(viewer).connectivity.assetTags({
        assetId: assetIdentity,
      });
      expect(tags.find((t) => t.tagId === "inlet")).toMatchObject({
        value: 2.8,
        currentEligible: true,
        configurationRevision: 1,
      });
      expect(before.publishedRevision).toBe(1);
    });
    it("retains delivery context after a lost HTTP acknowledgement and accepts the exact gateway receipt", async () => {
      const accepted = report("outlet", 6.2);
      await ingest(accepted);
      vi.mocked(fetch).mockRejectedValueOnce(
        new Error("synthetic lost response"),
      );
      expect(
        await caller(engineer).connectivity.publish({
          gatewayDeviceId: gatewayId,
          expectedRevision: 2,
        }),
      ).toMatchObject({ published: false, reason: "delivery_unconfirmed" });
      let state = await caller(viewer).connectivity.get({
        gatewayDeviceId: gatewayId,
      });
      expect(state.publication).toMatchObject({
        revision: 2,
        status: "unconfirmed",
      });
      expect(state.publishedRevision).toBe(1);
      await ingest({
        ...report(),
        connectionId: "gateway-configuration",
        configurationRevision: 2,
        state: "disabled",
        tags: [],
      });
      state = await caller(viewer).connectivity.get({
        gatewayDeviceId: gatewayId,
      });
      expect(state.publication).toBeNull();
      expect(state.publishedRevision).toBe(2);
      expect(state.reportedRevision).toBe(2);
      expect(state.activeConfiguration?.connections).toEqual([]);
      expect(
        await caller(viewer).connectivity.assetTags({ assetId: assetIdentity }),
      ).toEqual([]);
      expect(await ingest(accepted)).toMatchObject({ duplicate: true });
    });
    it("retains a probe's exact correlation after an unconfirmed response", async () => {
      vi.mocked(fetch).mockRejectedValueOnce(
        new Error("synthetic lost probe response"),
      );
      const probeConnection = {
        ...connection,
        connectionId: "uncertain-probe",
        tags: [],
      };
      const command = await caller(engineer).connectivity.probe({
        gatewayDeviceId: gatewayId,
        expectedRevision: 2,
        connection: probeConnection,
      });
      expect(command.published).toBe(false);
      expect(
        (await caller(viewer).connectivity.get({ gatewayDeviceId: gatewayId }))
          .probe?.status,
      ).toBe("unconfirmed");
      await ingest({
        ...report(),
        connectionId: probeConnection.connectionId,
        commandId: command.commandId,
        tags: [],
      });
      expect(
        (await caller(viewer).connectivity.get({ gatewayDeviceId: gatewayId }))
          .probe?.status,
      ).toBe("completed");
    });
    it("binds UADP diagnostics to the commissioned publisher and never treats unsecured packets as current evidence", async () => {
      const udp: IndustrialConnection = {
        connectionId: "udp",
        name: "UDP observer",
        protocol: "opcua_fx",
        endpoint: "opc.udp://127.0.0.1:4840",
        enabled: true,
        intervalMs: 1000,
        tags: [
          {
            tagId: "pressure",
            name: "Pressure",
            dataType: "float32",
            source: { fieldIndex: 0 },
            assetId: assetIdentity,
          },
        ],
        fx: {
          mode: "udp_uadp",
          allowUnsecured: true,
          publisherId: "20",
          publisherIdType: "UInt16",
          writerGroupId: 10,
          dataSetWriterId: 30,
          metadataMajorVersion: 1,
          metadataMinorVersion: 0,
        },
      };
      await caller(engineer).connectivity.save({
        gatewayDeviceId: gatewayId,
        expectedRevision: 2,
        connections: [udp],
      });
      await caller(engineer).connectivity.publish({
        gatewayDeviceId: gatewayId,
        expectedRevision: 3,
      });
      const observation: ConnectivityObservation = {
        ...report(),
        connectionId: "udp",
        configurationRevision: 3,
        tags: [
          {
            tagId: "pressure",
            dataType: "float32",
            value: 7.1,
            quality: "good",
            qualityBasis: "protocol",
          },
        ],
        fx: {
          mode: "udp_uadp",
          publisherId: "20",
          writerGroupId: 10,
          dataSetWriterId: 30,
          modelVerified: false,
          components: [],
          warnings: [],
          determinism: "unverified",
        },
      };
      await expect(ingest(observation)).rejects.toMatchObject({
        code: "connectivity_udp_evidence_mismatch",
      });
      observation.tags[0].quality = "uncertain";
      observation.tags[0].qualityBasis = "unauthenticated_udp";
      observation.fx!.publisherId = "21";
      await expect(ingest(observation)).rejects.toMatchObject({
        code: "connectivity_udp_publisher_mismatch",
      });
      observation.fx!.publisherId = "20";
      await ingest(observation);
      expect(
        (
          await caller(viewer).connectivity.assetTags({
            assetId: assetIdentity,
          })
        )[0],
      ).toMatchObject({
        value: 7.1,
        currentEligible: false,
        quality: "uncertain",
      });
      await (await getDb())!.execute(
        sql`delete from asset_devices where "assetId"=${assetId} and "deviceId"=${deviceId}`,
      );
      expect(
        await caller(viewer).connectivity.assetTags({ assetId: assetIdentity }),
      ).toEqual([]);
    });
  },
);
