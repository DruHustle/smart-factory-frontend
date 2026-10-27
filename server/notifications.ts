import { individualSecurityUser } from "./security/users";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alerts, assets, devices, notificationInbox } from "../drizzle/schema";
import { getDb } from "./db";
import { demoDataEnabled } from "./demoData";

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Notification database unavailable");
  return db;
}

function visibleNotificationSourceCondition() {
  const visibleDevice = demoDataEnabled()
    ? eq(devices.id, alerts.deviceId)
    : and(eq(devices.id, alerts.deviceId), eq(devices.isDemo, false));
  const visibleAsset = demoDataEnabled()
    ? eq(assets.assetId, alerts.assetId)
    : and(eq(assets.assetId, alerts.assetId), eq(assets.isDemo, false));
  return sql`(exists (
    select 1 from ${alerts}
    where ${alerts.id} = ${notificationInbox.alertId}
      and exists (select 1 from ${devices} where ${visibleDevice})
      and (${alerts.assetId} is null or exists (select 1 from ${assets} where ${visibleAsset}))
  ) or exists (select 1 from security_findings sf join security_sources ss on ss.id=sf.source_id where sf.id=${notificationInbox.securityFindingId} and ss.is_demo=false and ${process.env.ENABLE_DEMO_ACCOUNTS !== "true"} and exists(select 1 from users su where su.id=${notificationInbox.userId} and ${individualSecurityUser(sql`su`)})))`;
}

export async function listNotifications(userId: number) {
  return (await database())
    .select()
    .from(notificationInbox)
    .where(
      and(
        eq(notificationInbox.userId, userId),
        visibleNotificationSourceCondition(),
      ),
    )
    .orderBy(desc(notificationInbox.id))
    .limit(100);
}
export async function readNotification(userId: number, id: number) {
  const [row] = await (
    await database()
  )
    .update(notificationInbox)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationInbox.userId, userId),
        eq(notificationInbox.id, id),
        visibleNotificationSourceCondition(),
      ),
    )
    .returning({ id: notificationInbox.id });
  return row;
}
export async function retryNotification(userId: number, id: number) {
  const [row] = await (
    await database()
  )
    .update(notificationInbox)
    .set({
      emailStatus: "pending",
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
    })
    .where(
      and(
        eq(notificationInbox.userId, userId),
        eq(notificationInbox.id, id),
        visibleNotificationSourceCondition(),
        inArray(notificationInbox.emailStatus, [
          "failed",
          "no_recipient",
          "unconfigured",
        ]),
      ),
    )
    .returning({ id: notificationInbox.id });
  return row;
}
export function notificationConfiguration() {
  const provider = (process.env.EMAIL_PROVIDER ?? "resend").toLowerCase();
  const inferredConfiguration =
    provider === "ses"
      ? process.env.SES_ENABLED === "true" && Boolean(process.env.SES_FROM)
      : provider === "smtp"
        ? ["SMTP_USERNAME", "SMTP_FROM"].every((key) =>
            Boolean(process.env[key]),
          )
        : [
            "RESEND_API_KEY",
            "RESEND_FROM",
            "RESEND_ALLOWED_RECIPIENT_DOMAINS",
          ].every((key) => Boolean(process.env[key]));
  const emailConfigured =
    process.env.EMAIL_DELIVERY_CONFIGURED === undefined
      ? inferredConfiguration
      : process.env.EMAIL_DELIVERY_CONFIGURED === "true";
  const providerName =
    provider === "ses"
      ? "Amazon SES"
      : provider === "smtp"
        ? "Gmail SMTP"
        : "Resend";
  return [
    {
      provider: providerName,
      inboxEnabled: true,
      emailConfigured,
      workerEnabled: ["render-bundle", "compose", "local"].includes(
        process.env.BACKEND_DEPLOYMENT_MODE ?? "",
      ),
    },
  ];
}

export type NotificationFilter = {
  search?: string;
  view?: "all" | "unread" | "delivery_attention" | "accepted";
  page?: number;
};
export async function notificationPage(
  userId: number,
  input: NotificationFilter = {},
) {
  const db = await database(),
    search = "%" + (input.search ?? "").replace(/[\\%_]/g, "\\$&") + "%",
    view = input.view ?? "all",
    page = input.page ?? 0;
  const [result] = await db.execute(
    sql`with owned as materialized(select n.* from notification_inbox n where n."userId"=${userId} and exists(select 1 from ${notificationInbox} where ${notificationInbox.id}=n.id and ${visibleNotificationSourceCondition()})), filtered as(select * from owned where (${view}='all' or ${view}='unread' and "readAt" is null or ${view}='delivery_attention' and "emailStatus" in('failed','unconfigured','no_recipient') or ${view}='accepted' and "emailStatus"='accepted') and (title ilike ${search} or body ilike ${search} or kind ilike ${search})), paged as(select * from filtered order by id desc limit 25 offset ${page * 25}) select coalesce((select jsonb_agg(p) from paged p),'[]'::jsonb) as items,(select count(*)::int from filtered) as total,(select count(*)::int from owned where "readAt" is null) as unread,(select count(*)::int from owned where "emailStatus" in('failed','unconfigured','no_recipient')) as attention,(select count(*)::int from owned where "emailStatus"='accepted') as accepted,(select count(*)::int from owned) as available`,
  );
  const rows = result.items as Record<string, unknown>[];
  return {
    items: rows.map((r) => ({
      id: Number(r.id),
      alertId: r.alertId == null ? null : Number(r.alertId),
      securityFindingId: r.securityFindingId as string | null,
      title: String(r.title),
      body: String(r.body),
      kind: String(r.kind),
      createdAt: new Date(String(r.createdAt)),
      readAt: r.readAt ? new Date(String(r.readAt)) : null,
      emailStatus: String(r.emailStatus),
      lastError: r.lastError as string | null,
      attempts: Number(r.attempts),
    })),
    total: Number(result.total),
    page,
    returned: rows.length,
    hasMore: (page + 1) * 25 < Number(result.total),
    truncated: false,
    summary: {
      unread: Number(result.unread),
      attention: Number(result.attention),
      accepted: Number(result.accepted),
      available: Number(result.available),
    },
  };
}
export const emptyNotificationPage = () => ({
  items: [] as Awaited<ReturnType<typeof notificationPage>>["items"],
  total: 0,
  page: 0,
  returned: 0,
  hasMore: false,
  truncated: false,
  summary: { unread: 0, attention: 0, accepted: 0, available: 0 },
});
export async function notificationSummary(userId: number) {
  const db = await database();
  const [row] = await db.execute(
    sql`select count(*)::int as available,count(*) filter(where ${notificationInbox.readAt} is null)::int as unread,count(*) filter(where ${notificationInbox.emailStatus} in('failed','unconfigured','no_recipient'))::int as attention,count(*) filter(where ${notificationInbox.emailStatus}='accepted')::int as accepted from ${notificationInbox} where ${notificationInbox.userId}=${userId} and ${visibleNotificationSourceCondition()}`,
  );
  return {
    available: Number(row.available),
    unread: Number(row.unread),
    attention: Number(row.attention),
    accepted: Number(row.accepted),
  };
}
