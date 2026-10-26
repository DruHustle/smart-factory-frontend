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
  ) or exists (select 1 from security_findings sf join security_sources ss on ss.id=sf.source_id where sf.id=${notificationInbox.securityFindingId} and ss.is_demo=false and ${process.env.ENABLE_DEMO_ACCOUNTS!=="true"} and exists(select 1 from users su where su.id=${notificationInbox.userId} and ${individualSecurityUser(sql`su`)})))`;
}

export async function listNotifications(userId: number) {
  return (await database()).select().from(notificationInbox)
    .where(and(eq(notificationInbox.userId, userId), visibleNotificationSourceCondition()))
    .orderBy(desc(notificationInbox.id)).limit(100);
}
export async function readNotification(userId: number, id: number) {
  const [row] = await (await database()).update(notificationInbox).set({ readAt: new Date() })
    .where(and(eq(notificationInbox.userId, userId), eq(notificationInbox.id, id), visibleNotificationSourceCondition()))
    .returning({ id: notificationInbox.id });
  return row;
}
export async function retryNotification(userId: number, id: number) {
  const [row] = await (await database()).update(notificationInbox)
    .set({ emailStatus: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null })
    .where(and(eq(notificationInbox.userId, userId), eq(notificationInbox.id, id),
      visibleNotificationSourceCondition(),
      inArray(notificationInbox.emailStatus, ["failed", "no_recipient", "unconfigured"])))
    .returning({ id: notificationInbox.id });
  return row;
}
export function notificationConfiguration() {
  const provider = (process.env.EMAIL_PROVIDER ?? "resend").toLowerCase();
  const inferredConfiguration = provider === "ses"
    ? process.env.SES_ENABLED === "true" && Boolean(process.env.SES_FROM)
    : provider === "smtp"
      ? ["SMTP_USERNAME", "SMTP_FROM"].every(key => Boolean(process.env[key]))
      : ["RESEND_API_KEY", "RESEND_FROM", "RESEND_ALLOWED_RECIPIENT_DOMAINS"].every(key => Boolean(process.env[key]));
  const emailConfigured = process.env.EMAIL_DELIVERY_CONFIGURED === undefined
    ? inferredConfiguration
    : process.env.EMAIL_DELIVERY_CONFIGURED === "true";
  const providerName = provider === "ses" ? "Amazon SES" : provider === "smtp" ? "Gmail SMTP" : "Resend";
  return [{ provider: providerName, inboxEnabled: true,
    emailConfigured,
    workerEnabled: ["render-bundle", "compose", "local"].includes(process.env.BACKEND_DEPLOYMENT_MODE ?? "") }];
}
