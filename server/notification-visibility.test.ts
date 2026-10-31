import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { notificationInbox, users, type User } from "../drizzle/schema";
import { dataWorkspaceCookie } from "../shared/data-workspace";
import { createUser, getDb, getUserById } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { disposableDatabase } from "./test/disposableDatabase";

type Notice = typeof notificationInbox.$inferSelect;
type Actor =
  | "owner"
  | "other"
  | "engineer"
  | "viewer"
  | "shared"
  | "sharedPrefix";
type FixtureNotices = {
  security: Notice;
  infrastructure: Notice;
  accepted: Notice;
  demo: Notice;
  invalidDemoDelivery: Notice;
};
type Caller = ReturnType<typeof appRouter.createCaller>;

/** No sender, worker or external source is started; every record belongs to this disposable database. */
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "notification visibility on an origin with individual and shared demo accounts",
  () => {
    disposableDatabase("notification_visibility");
    let database: NonNullable<Awaited<ReturnType<typeof getDb>>>;
    const actors = {} as Record<Actor, User>;
    const notices = {} as Record<Actor, FixtureNotices>;
    const liveFinding = randomUUID();
    const demoFinding = randomUUID();
    const infrastructureEvent = randomUUID();

    beforeAll(async () => {
      database = (await getDb())!;
      const identities = [
        ["owner", "admin", "owner@example.test", randomUUID()],
        ["other", "admin", "other@example.test", randomUUID()],
        ["engineer", "engineer", "engineer@example.test", randomUUID()],
        ["viewer", "viewer", "viewer@example.test", randomUUID()],
        ["shared", "admin", "admin@dev.local", randomUUID()],
        [
          "sharedPrefix",
          "admin",
          "renamed-demo@example.test",
          `demo-${randomUUID()}`,
        ],
      ] as const;
      for (const [key, role, email, openId] of identities) {
        const user = await createUser({ openId, role, email, name: key });
        if (!user)
          throw Error("Disposable notification identity was not created");
        actors[key] = user;
      }
      await database.execute(
        sql`insert into security_rules(id,version,settings,active) values('notification-visibility-fixture',1,'{}'::jsonb,false)`,
      );
      for (const [findingId, isDemo] of [
        [liveFinding, false],
        [demoFinding, true],
      ] as const) {
        const sourceId = randomUUID();
        await database.execute(
          sql`insert into security_sources(id,name,namespace,is_demo,policy) values(${sourceId},'Disposable notification source',${sourceId},${isDemo},'{}'::jsonb)`,
        );
        await database.execute(
          sql`insert into security_findings(id,fingerprint,source_id,rule_id,rule_version,title,category,severity,confidence,mode,explanation,first_seen,last_seen,condition_until) values(${findingId},${createHash("sha256").update(findingId).digest("hex")},${sourceId},'notification-visibility-fixture',1,'Disposable notification finding','authentication','warning','observed',${isDemo ? "simulated" : "live"},'{}'::jsonb,now(),now(),now()+interval '1 hour')`,
        );
      }
      await database.execute(
        sql`insert into infrastructure_events(id,service_id,name,state,occurred_at,kind,reason,dedupe_key) values(${infrastructureEvent},'fixture-api','Disposable API','unavailable',now(),'incident','FIXTURE_FAILURE',${infrastructureEvent})`,
      );
    });

    beforeEach(async () => {
      vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "true");
      vi.stubEnv("PUBLIC_DEMO_DEPLOYMENT", "true");
      vi.stubEnv("SECURITY_ENABLED", "false");
      vi.stubEnv("EMAIL_DELIVERY_CONFIGURED", "false");
      vi.stubEnv("INFRASTRUCTURE_EMAIL_ENABLED", "false");
      await database.delete(notificationInbox);
      for (const key of Object.keys(actors) as Actor[]) {
        await database
          .update(users)
          .set({ role: actors[key].role, disabledAt: null })
          .where(eq(users.id, actors[key].id));
        const owned = {
          userId: actors[key].id,
          body: "Synthetic visibility fixture; no email delivery is run.",
        };
        const rows = await database
          .insert(notificationInbox)
          .values([
            {
              ...owned,
              kind: "security",
              title: "Private security failure",
              securityFindingId: liveFinding,
              emailStatus: "failed",
              attempts: 3,
              lastError: "FIXTURE_FAILURE",
            },
            {
              ...owned,
              kind: "infrastructure",
              title: "Private infrastructure failure",
              infrastructureEventId: infrastructureEvent,
              emailStatus: "failed",
              attempts: 2,
              lastError: "FIXTURE_FAILURE",
            },
            {
              ...owned,
              kind: "security",
              title: "Accepted private security notice",
              securityFindingId: liveFinding,
              emailStatus: "accepted",
              readAt: new Date(),
              acceptedAt: new Date(),
            },
            {
              ...owned,
              kind: "security",
              title: "Isolated demo security notice",
              securityFindingId: demoFinding,
              emailStatus: "demo_only",
            },
            {
              ...owned,
              kind: "security",
              title: "Demo source with an invalid delivery state",
              securityFindingId: demoFinding,
              emailStatus: "failed",
            },
          ])
          .returning();
        const named = (title: string) =>
          rows.find((row) => row.title === title)!;
        notices[key] = {
          security: named("Private security failure"),
          infrastructure: named("Private infrastructure failure"),
          accepted: named("Accepted private security notice"),
          demo: named("Isolated demo security notice"),
          invalidDemoDelivery: named(
            "Demo source with an invalid delivery state",
          ),
        };
      }
    });

    const caller = async (actor: Actor, workspace: "live" | "demo" = "live") =>
      appRouter.createCaller({
        user: await getUserById(actors[actor].id),
        req: { headers: { cookie: `${dataWorkspaceCookie}=${workspace}` } },
        res: {},
      } as unknown as TrpcContext);

    const saved = async (id: number) => {
      const [row] = await database
        .select()
        .from(notificationInbox)
        .where(eq(notificationInbox.id, id));
      return row;
    };

    async function expectInbox(api: Caller, expected: Notice[]) {
      const expectedIds = expected.map((row) => row.id).sort((a, b) => b - a);
      const summary = {
        available: expected.length,
        unread: expected.filter((row) => row.readAt === null).length,
        attention: expected.filter((row) =>
          ["failed", "no_recipient", "unconfigured"].includes(row.emailStatus),
        ).length,
        accepted: expected.filter((row) => row.emailStatus === "accepted")
          .length,
      };
      expect((await api.notifications.list()).map((row) => row.id)).toEqual(
        expectedIds,
      );
      expect(await api.notifications.summary()).toEqual(summary);
      const page = await api.notifications.page({});
      expect(page.items.map((row) => row.id)).toEqual(expectedIds);
      expect(page).toMatchObject({
        total: expected.length,
        returned: expected.length,
        page: 0,
        hasMore: false,
        summary,
      });
    }

    it("returns only the individual owner's live notices consistently across list, page, summary and filters", async () => {
      const api = await caller("owner");
      await expectInbox(api, [
        notices.owner.security,
        notices.owner.infrastructure,
        notices.owner.accepted,
      ]);
      const attention = await api.notifications.page({
        view: "delivery_attention",
      });
      expect(attention.items.map((row) => row.id)).toEqual([
        notices.owner.infrastructure.id,
        notices.owner.security.id,
      ]);
      expect(attention.total).toBe(2);
      expect(attention.summary).toEqual({
        available: 3,
        unread: 2,
        attention: 2,
        accepted: 1,
      });
      const unread = await api.notifications.page({ view: "unread" });
      expect(unread.items.map((row) => row.id)).toEqual(
        attention.items.map((row) => row.id),
      );
      const accepted = await api.notifications.page({ view: "accepted" });
      expect(accepted.items.map((row) => row.id)).toEqual([
        notices.owner.accepted.id,
      ]);
      const search = await api.notifications.page({
        search: "Private infrastructure",
      });
      expect(search.items.map((row) => row.id)).toEqual([
        notices.owner.infrastructure.id,
      ]);
      expect(search.summary).toEqual(attention.summary);
    });

    it("keeps pagination and counts scoped to the owner when private notifications span multiple pages", async () => {
      const extra = await database
        .insert(notificationInbox)
        .values(
          Array.from({ length: 26 }, (_, index) => ({
            userId: actors.owner.id,
            kind: "security",
            securityFindingId: liveFinding,
            title: `Owned page fixture ${index}`,
            body: "Synthetic pagination fixture.",
            emailStatus: "inbox_only",
          })),
        )
        .returning();
      const api = await caller("owner");
      const first = await api.notifications.page({ page: 0 });
      const second = await api.notifications.page({ page: 1 });
      const expectedIds = [
        ...extra,
        notices.owner.security,
        notices.owner.infrastructure,
        notices.owner.accepted,
      ]
        .map((row) => row.id)
        .sort((a, b) => b - a);
      expect(first).toMatchObject({ returned: 25, total: 29, hasMore: true });
      expect(second).toMatchObject({ returned: 4, total: 29, hasMore: false });
      expect([...first.items, ...second.items].map((row) => row.id)).toEqual(
        expectedIds,
      );
      expect((await api.notifications.list()).map((row) => row.id)).toEqual(
        expectedIds,
      );
      expect(first.summary).toEqual(await api.notifications.summary());
      expect(second.summary).toEqual(first.summary);
    });

    it("marks and retries only visible owned notices and keeps all counts consistent", async () => {
      const api = await caller("owner");
      for (const hidden of [
        notices.other.security,
        notices.other.infrastructure,
        notices.owner.demo,
        notices.owner.invalidDemoDelivery,
      ]) {
        await expect(
          api.notifications.markRead({ id: hidden.id }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          api.notifications.retryEmail({ id: hidden.id }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(await saved(hidden.id)).toEqual(hidden);
      }
      for (const notice of [
        notices.owner.security,
        notices.owner.infrastructure,
      ]) {
        await expect(
          api.notifications.markRead({ id: notice.id }),
        ).resolves.toEqual({ id: notice.id });
        await expect(
          api.notifications.retryEmail({ id: notice.id }),
        ).resolves.toEqual({ id: notice.id });
        expect(await saved(notice.id)).toMatchObject({
          readAt: expect.any(Date),
          emailStatus: "pending",
          attempts: 0,
          lastError: null,
        });
      }
      await expect(
        api.notifications.retryEmail({ id: notices.owner.accepted.id }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expectInbox(api, [
        (await saved(notices.owner.security.id))!,
        (await saved(notices.owner.infrastructure.id))!,
        notices.owner.accepted,
      ]);
      expect(await api.notifications.summary()).toEqual({
        available: 3,
        unread: 0,
        attention: 0,
        accepted: 1,
      });
    });

    it("isolates the individual's Demo view and rejects inbox mutations before changing private notices", async () => {
      const api = await caller("owner", "demo");
      await expectInbox(api, [notices.owner.demo]);
      for (const notice of [
        notices.owner.security,
        notices.owner.infrastructure,
        notices.owner.demo,
      ]) {
        await expect(
          api.notifications.markRead({ id: notice.id }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          api.notifications.retryEmail({ id: notice.id }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(await saved(notice.id)).toEqual(notice);
      }
      await expectInbox(await caller("owner", "live"), [
        notices.owner.security,
        notices.owner.infrastructure,
        notices.owner.accepted,
      ]);
    });

    it.each(["shared", "sharedPrefix"] as const)(
      "keeps %s isolated even when private rows exist for that identity and its cookie asks for Live",
      async (actor) => {
        const api = await caller(actor, "live");
        await expectInbox(api, [notices[actor].demo]);
        for (const notice of [
          notices[actor].security,
          notices[actor].infrastructure,
          notices[actor].demo,
        ]) {
          await expect(
            api.notifications.markRead({ id: notice.id }),
          ).rejects.toMatchObject({ code: "FORBIDDEN" });
          await expect(
            api.notifications.retryEmail({ id: notice.id }),
          ).rejects.toMatchObject({ code: "FORBIDDEN" });
          expect(await saved(notice.id)).toEqual(notice);
        }
      },
    );

    it.each(["engineer", "viewer"] as const)(
      "keeps Live %s security notices owner-scoped without granting infrastructure access or an elevated retry role",
      async (actor) => {
        const api = await caller(actor);
        await expectInbox(api, [
          notices[actor].security,
          notices[actor].accepted,
        ]);
        await expect(
          api.notifications.markRead({ id: notices[actor].security.id }),
        ).resolves.toEqual({ id: notices[actor].security.id });
        const retry = api.notifications.retryEmail({
          id: notices[actor].security.id,
        });
        if (actor === "engineer")
          await expect(retry).resolves.toEqual({
            id: notices[actor].security.id,
          });
        else await expect(retry).rejects.toMatchObject({ code: "FORBIDDEN" });
      },
    );

    it("rechecks the stored administrator role so demotion hides old infrastructure notices even from a previously created caller", async () => {
      const staleAdmin = await caller("owner");
      await expectInbox(staleAdmin, [
        notices.owner.security,
        notices.owner.infrastructure,
        notices.owner.accepted,
      ]);
      await database
        .update(users)
        .set({ role: "engineer" })
        .where(eq(users.id, actors.owner.id));
      await expectInbox(staleAdmin, [
        notices.owner.security,
        notices.owner.accepted,
      ]);
      await expect(
        staleAdmin.notifications.markRead({
          id: notices.owner.infrastructure.id,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        staleAdmin.notifications.retryEmail({
          id: notices.owner.infrastructure.id,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await saved(notices.owner.infrastructure.id)).toEqual(
        notices.owner.infrastructure,
      );
      const [stillStored] = await database
        .select({ id: notificationInbox.id })
        .from(notificationInbox)
        .where(
          and(
            eq(notificationInbox.userId, actors.owner.id),
            eq(notificationInbox.id, notices.owner.infrastructure.id),
          ),
        );
      expect(stillStored.id).toBe(notices.owner.infrastructure.id);
    });
  },
);
