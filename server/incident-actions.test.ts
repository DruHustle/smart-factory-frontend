import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alerts, devices, type User } from "../drizzle/schema";
import { sql } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";
import * as fixtureBoundary from "./demoTarget";
import * as actionStore from "./incidentActions";
import { appRouter } from "./routers";
import { disposableDatabase } from "./test/disposableDatabase";
import { createUser, getAlertById, getDb } from "./db";
import { registerDevice } from "./deviceRegistration";
import { incidentHistory } from "./incidents";

function caller(role: User["role"]) {
  const user = {
    id: 42,
    openId: "action-test",
    email: "engineer@example.test",
    name: "Reviewer",
    loginMethod: "password",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  } satisfies User;
  return appRouter.createCaller({
    user,
    req: { protocol: "http", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as TrpcContext["res"],
  });
}

describe("follow-up action authorization", () => {
  beforeEach(() => {
    vi.spyOn(fixtureBoundary, "rejectFixtureMutation").mockResolvedValue(
      undefined,
    );
    vi.spyOn(actionStore, "createIncidentAction").mockResolvedValue({ id: 8 });
    vi.spyOn(actionStore, "updateIncidentAction").mockResolvedValue({
      id: 8,
      version: 2,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("requires an engineer and validates title, due date and outcome", async () => {
    const input = {
      id: 1,
      title: "Inspect pump",
      ownerId: 3,
      dueDate: "2026-12-10",
    };
    await expect(
      caller("viewer").alerts.createAction(input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller("operator").alerts.createAction(input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller("engineer").alerts.createAction(input);
    expect(actionStore.createIncidentAction).toHaveBeenCalledWith(input, 42);
    await expect(
      caller("engineer").alerts.createAction({
        ...input,
        dueDate: "2026-02-30",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller("engineer").alerts.createAction({ ...input, title: "  " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller("engineer").alerts.updateAction({
        id: 1,
        actionId: 8,
        expectedVersion: 1,
        ownerId: 3,
        dueDate: null,
        status: "completed",
        outcome: null,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(actionStore.createIncidentAction).toHaveBeenCalledTimes(1);
    expect(actionStore.updateIncidentAction).not.toHaveBeenCalled();
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "persisted follow-up actions",
  () => {
    disposableDatabase("incident_actions");
    it("persists ownership and outcome, enforces parent identity and leaves the incident open", async () => {
      const db = (await getDb())!;
      const device = await registerDevice({
        deviceId: "action-source",
        name: "Action source",
        type: "sensor",
        route: "direct",
      });
      const engineer = (await createUser({
        openId: "action-engineer",
        email: "action@example.test",
        name: "Action engineer",
        role: "engineer",
      }))!;
      const viewer = (await createUser({
        openId: "action-viewer",
        email: "viewer@example.test",
        name: "Viewer",
        role: "viewer",
      }))!;
      const created = await db
        .insert(alerts)
        .values([
          {
            deviceId: device.id,
            type: "system_error",
            severity: "warning",
            message: "Action incident",
          },
          {
            deviceId: device.id,
            type: "system_error",
            severity: "warning",
            message: "Other incident",
          },
        ])
        .returning();
      const id = created[0].id;
      await expect(
        actionStore.createIncidentAction(
          { id, title: "Invalid owner", ownerId: viewer.id, dueDate: null },
          engineer.id,
        ),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const action = await actionStore.createIncidentAction(
        {
          id,
          title: "Inspect the pump",
          ownerId: engineer.id,
          dueDate: "2026-12-10",
        },
        engineer.id,
      );
      const earlier = await actionStore.createIncidentAction(
        {
          id: created[1].id,
          title: "Check earlier issue",
          ownerId: engineer.id,
          dueDate: "2026-12-01",
        },
        engineer.id,
      );
      expect((await actionStore.incidentActions(id)).items[0]).toMatchObject({
        id: action.id,
        ownerId: engineer.id,
        dueDate: "2026-12-10",
        status: "open",
        version: 1,
      });
      expect(await actionStore.incidentActionQueue(0, 1)).toMatchObject({
        items: [{ id: earlier.id }],
        hasMore: true,
      });
      expect((await actionStore.incidentActionQueue(1, 1)).items).toMatchObject(
        [{ id: action.id, incidentId: id, title: "Inspect the pump" }],
      );
      await expect(
        actionStore.updateIncidentAction(
          {
            id: created[1].id,
            actionId: action.id,
            expectedVersion: 1,
            ownerId: engineer.id,
            dueDate: null,
            status: "in_progress",
            outcome: null,
          },
          engineer.id,
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await actionStore.updateIncidentAction(
        {
          id,
          actionId: action.id,
          expectedVersion: 1,
          ownerId: engineer.id,
          dueDate: "2026-12-10",
          status: "completed",
          outcome: "Inspection completed; pressure stable.",
        },
        engineer.id,
      );
      await expect(
        actionStore.updateIncidentAction(
          {
            id,
            actionId: action.id,
            expectedVersion: 1,
            ownerId: engineer.id,
            dueDate: null,
            status: "open",
            outcome: null,
          },
          engineer.id,
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await actionStore.incidentActions(id)).items[0]).toMatchObject({
        status: "completed",
        outcome: "Inspection completed; pressure stable.",
        version: 2,
      });
      expect((await getAlertById(id))?.status).toBe("active");
      expect((await actionStore.incidentActionQueue(0, 3)).items).toMatchObject(
        [{ id: earlier.id }],
      );
      const history = await incidentHistory(id);
      expect(history.items.map((entry) => entry.detail.text)).toEqual([
        "Action updated: Inspect the pump",
        "Action created: Inspect the pump",
      ]);
      expect(
        history.items.every((entry) => entry.actorId === engineer.id),
      ).toBe(true);
      const [demoDevice] = await db
        .insert(devices)
        .values({
          deviceId: "demo-action-source",
          name: "Demo action source",
          type: "sensor",
          isDemo: true,
        })
        .returning();
      const [demoIncident] = await db
        .insert(alerts)
        .values({
          deviceId: demoDevice.id,
          type: "system_error",
          severity: "warning",
          message: "Demo incident",
        })
        .returning();
      await db.execute(
        sql`insert into incident_actions(alert_id,title,owner_id,created_by) values(${demoIncident.id},'Demo only action',${engineer.id},${engineer.id})`,
      );
      expect((await actionStore.incidentActionQueue(0, 3)).items).toMatchObject(
        [{ id: earlier.id }],
      );
      await expect(
        caller("engineer").alerts.createAction({
          id: demoIncident.id,
          title: "Forbidden demo write",
          ownerId: engineer.id,
          dueDate: null,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  },
);
