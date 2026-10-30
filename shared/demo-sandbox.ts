import {
  demoFactory,
  demoFactoryActivity,
  type DemoFactoryAction,
} from "./demo-factory-types";
import {
  applyDemoFactoryAction,
  appendDemoFactoryActivity,
} from "./demo-factories";
import { z } from "zod";
import { canonicalUnits, metrics, type Metric } from "./measurements";
import type { InventoryItem } from "./inventory";
export const sandboxRole = z.enum(["viewer", "operator", "engineer", "admin"]);
export type SandboxRole = z.infer<typeof sandboxRole>;
const text = z.string().trim().min(1).max(180),
  ref = z
    .string()
    .regex(/^(?:asset:[1-9]\d*|device:[1-9]\d*|equipment:[a-f0-9-]{36})$/),
  at = z.string().datetime();
export const sandboxItem = z
  .object({
    ref,
    identifier: z.string().max(180),
    name: text,
    kind: z.enum(["asset", "device", "equipment"]),
    itemType: z.string().max(80),
    zone: z.string().max(80).nullable(),
    manufacturer: z.string().max(180).default("Example manufacturer"),
    model: z.string().max(100).default("Demonstration model"),
    serial: z.string().max(100).default("DEMO"),
    connected: z.boolean().default(false),
    custom: z.boolean().default(false),
    equipmentId: z.string().nullable().default(null),
  })
  .strict();
const sample = z.object({
  id: z.uuid(),
  itemRef: ref,
  metric: z.enum(metrics),
  value: z.number().finite().min(-1e12).max(1e12),
  unit: z.string().max(32),
  at,
});
const incident = z.object({
  id: z.uuid(),
  itemRef: ref,
  metric: z.enum(metrics),
  severity: z.enum(["warning", "critical"]),
  message: z.string().max(500),
  status: z.enum(["open", "acknowledged", "resolved"]),
  at,
  acknowledgedBy: z.string().max(32).nullable().default(null),
  notificationRecorded: z.boolean().default(false),
});
export const demoSandbox = z
  .object({
    version: z.literal(2),
    id: z.uuid(),
    updatedAt: at,
    items: z.array(sandboxItem).max(500),
    factories: z.array(demoFactory).max(100).default([]),
    factoryActivity: z.array(demoFactoryActivity).max(5000).default([]),
    factoryDeletedRefs: z.array(ref).max(5000).default([]),
    samples: z.array(sample).max(1000),
    thresholds: z
      .array(
        z.object({
          itemRef: ref,
          metric: z.enum(metrics),
          warning: z.number().finite(),
          critical: z.number().finite(),
          direction: z.enum(["above", "below"]),
        }),
      )
      .max(500),
    incidents: z.array(incident).max(200),
    users: z
      .array(z.object({ id: z.uuid(), name: text, role: sandboxRole }))
      .max(25),
    firmware: z
      .array(z.object({ id: z.uuid(), version: z.string().min(1).max(64), at }))
      .max(30),
    deployments: z
      .array(
        z.object({
          id: z.uuid(),
          itemRef: ref,
          version: z.string().max(64),
          status: z.enum(["queued", "completed"]),
          at,
        }),
      )
      .max(100),
    findings: z
      .array(
        z.object({
          id: z.uuid(),
          itemRef: ref,
          title: text,
          state: z.enum(["open", "investigated", "deferred", "resolved"]),
          decision: z.string().max(1000),
          at,
        }),
      )
      .max(100),
    scenario: z.enum(["normal", "late-delivery", "clock-loss", "recovery"]),
    settings: z.object({
      name: z.string().min(1).max(120),
      protocol: z.enum(["MQTT", "OPC UA", "Modbus"]),
      notifications: z.boolean(),
    }),
    audit: z
      .array(
        z.object({
          id: z.uuid(),
          at,
          role: sandboxRole,
          action: z.string().max(180),
        }),
      )
      .max(250),
  })
  .strict()
  .superRefine((s, ctx) => {
    const assigned = new Set<string>();
    const factoryIds = new Set(s.factories.map((f) => f.id));
    if (
      factoryIds.size !== s.factories.length ||
      new Set(s.factories.map((f) => f.draft.document.name.toLowerCase()))
        .size !== s.factories.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Factory identities and names must be unique",
        path: ["factories"],
      });
    if (
      s.factoryActivity.some((e) => !factoryIds.has(e.factoryId)) ||
      new Set(s.factoryActivity.map((e) => e.id)).size !==
        s.factoryActivity.length
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Factory history must have unique entries for existing factories",
        path: ["factoryActivity"],
      });

    s.factories.forEach((factory, index) =>
      factory.draft.document.placements.forEach((p) => {
        if (!s.items.some((i) => i.ref === p.ref) || assigned.has(p.ref))
          ctx.addIssue({
            code: "custom",
            message: "A factory item must have one available inventory record",
            path: ["factories", index],
          });
        assigned.add(p.ref);
      }),
    );
    if (s.factoryDeletedRefs.some((ref) => s.items.some((i) => i.ref === ref)))
      ctx.addIssue({
        code: "custom",
        message: "Deleted demo inventory cannot remain active",
        path: ["factoryDeletedRefs"],
      });
    const refs = new Set(s.items.map((i) => i.ref));
    if (refs.size !== s.items.length)
      ctx.addIssue({
        code: "custom",
        message: "Demo equipment identities must be unique",
        path: ["items"],
      });
    for (const field of [
      "samples",
      "thresholds",
      "incidents",
      "deployments",
      "findings",
    ] as const) {
      s[field].forEach((row, index) => {
        if (!refs.has(row.itemRef))
          ctx.addIssue({
            code: "custom",
            message: "Demo record refers to missing equipment",
            path: [field, index],
          });
      });
    }
    s.samples.forEach((row, index) => {
      if (row.unit !== canonicalUnits[row.metric])
        ctx.addIssue({
          code: "custom",
          message: "Demo samples require the canonical engineering unit",
          path: ["samples", index, "unit"],
        });
    });
  });
export type DemoSandbox = z.infer<typeof demoSandbox>;
export type SandboxAction =
  | DemoFactoryAction
  | {
      type: "item.save";
      item: Partial<z.infer<typeof sandboxItem>> &
        Pick<z.infer<typeof sandboxItem>, "name" | "kind" | "itemType">;
    }
  | { type: "item.connect"; ref: string; connected: boolean }
  | { type: "sample"; ref: string; metric: Metric; value: number }
  | {
      type: "threshold";
      ref: string;
      metric: Metric;
      warning: number;
      critical: number;
      direction: "above" | "below";
    }
  | { type: "incident"; id: string; status: "acknowledged" | "resolved" }
  | { type: "user"; name: string; role: SandboxRole; id?: string }
  | { type: "firmware"; version: string }
  | { type: "deploy"; ref: string; version: string }
  | { type: "completeDeployment"; id: string }
  | { type: "finding"; ref: string }
  | {
      type: "decision";
      id: string;
      decision: string;
      state: "investigated" | "deferred" | "resolved";
    }
  | { type: "scenario"; scenario: DemoSandbox["scenario"] }
  | { type: "settings"; settings: DemoSandbox["settings"] };
export const demoRoleAllows = (role: SandboxRole, minimum: SandboxRole) =>
  ({ viewer: 0, operator: 1, engineer: 2, admin: 3 })[role] >=
  { viewer: 0, operator: 1, engineer: 2, admin: 3 }[minimum];

export function seedDemoSandbox(
  inventory: InventoryItem[],
  now = new Date().toISOString(),
): DemoSandbox {
  const items = inventory
    .filter((i) => i.isDemo)
    .slice(0, 500)
    .map((i) =>
      sandboxItem.parse({
        ref: i.ref,
        identifier: i.identifier,
        name: i.name,
        kind: i.kind,
        itemType: i.itemType,
        zone: i.zone,
        connected: i.configured,
        equipmentId: i.equipmentId,
      }),
    );
  const samples = inventory
    .filter((i) => items.some((s) => s.ref === i.ref))
    .flatMap((i) =>
      metrics.flatMap((metric) => {
        const m = i.measurements?.[metric];
        return m?.quality === "good" &&
          m.canonicalValue != null &&
          m.canonicalUnit === canonicalUnits[metric] &&
          i.sampleAt
          ? [
              {
                id: crypto.randomUUID(),
                itemRef: i.ref,
                metric,
                value: m.canonicalValue,
                unit: m.canonicalUnit,
                at: new Date(i.sampleAt).toISOString(),
              },
            ]
          : [];
      }),
    )
    .slice(-1000);
  return demoSandbox.parse({
    version: 2,
    id: crypto.randomUUID(),
    updatedAt: now,
    items,
    samples,
    thresholds: [],
    incidents: [],
    users: [
      { id: crypto.randomUUID(), name: "Example Viewer", role: "viewer" },
      { id: crypto.randomUUID(), name: "Example Engineer", role: "engineer" },
    ],
    firmware: [],
    deployments: [],
    findings: [],
    scenario: "normal",
    settings: {
      name: "My demo factory",
      protocol: "MQTT",
      notifications: true,
    },
    audit: [],
  });
}

export function applySandboxAction(
  source: DemoSandbox,
  role: SandboxRole,
  action: SandboxAction,
): DemoSandbox {
  const minimum: SandboxRole =
    action.type === "factory.deleteItem"
      ? "admin"
      : action.type.startsWith("factory.")
        ? "engineer"
        : action.type === "scenario"
          ? "viewer"
          : ["user", "settings"].includes(action.type)
            ? "admin"
            : [
                  "item.save",
                  "item.connect",
                  "threshold",
                  "firmware",
                  "deploy",
                  "completeDeployment",
                  "finding",
                  "decision",
                ].includes(action.type)
              ? "engineer"
              : "operator";
  if (!demoRoleAllows(role, minimum))
    throw Error(
      `This demo action requires ${minimum} access. Switch demo role to try it.`,
    );
  const s = structuredClone(source),
    now = new Date().toISOString();
  const item = (id: string) => {
    const row = s.items.find((i) => i.ref === id);
    if (!row) throw Error("Choose an item in this demo workspace.");
    return row;
  };
  if (
    action.type === "factory.create" ||
    action.type === "factory.save" ||
    action.type === "factory.add" ||
    action.type === "factory.attach" ||
    action.type === "factory.deleteItem"
  ) {
    applyDemoFactoryAction(s, role, action as DemoFactoryAction, (input) => {
      const before = new Set(s.items.map((i) => i.ref));
      const added = applySandboxAction(s, role, {
        type: "item.save",
        item: {
          name: input.name,
          kind: input.kind,
          itemType: input.itemType,
          zone: null,
        },
      });
      s.items = added.items;
      const item = s.items.find((i) => !before.has(i.ref))!;
      if (input.kind === "device") item.identifier = input.identifier;
      return item;
    });
  } else if (action.type === "item.save") {
    const old = action.item.ref
      ? s.items.find((i) => i.ref === action.item.ref)
      : undefined;
    if (action.item.ref && !old) throw Error("Demo item not found.");
    if (!old && s.items.length >= 500)
      throw Error("This sandbox supports 500 items.");
    const kind = old?.kind ?? action.item.kind;
    // Keep references distinct across resets so a retained layout draft cannot
    // silently attach an old position to a different custom item.
    let identity: string, ref: string;
    do {
      identity = crypto.randomUUID();
      const id = (
        3000000000n + BigInt(`0x${identity.replaceAll("-", "").slice(-13)}`)
      ).toString();
      ref = `${kind}:${kind === "equipment" ? identity : id}`;
    } while (s.items.some((i) => i.ref === ref));
    const data = sandboxItem.parse({
      ...old,
      ...action.item,
      kind,
      ref: old?.ref ?? ref,
      identifier: old?.identifier ?? `urn:demo:sandbox:${identity}`,
      custom: old?.custom ?? true,
    });
    s.items = old
      ? s.items.map((i) => (i.ref === old.ref ? data : i))
      : [...s.items, data];
  } else if (action.type === "item.connect")
    item(action.ref).connected = action.connected;
  else if (action.type === "sample") {
    item(action.ref);
    const measurement = sample.parse({
      id: crypto.randomUUID(),
      itemRef: action.ref,
      metric: action.metric,
      value: action.value,
      unit: canonicalUnits[action.metric],
      at: now,
    });
    s.samples = [...s.samples, measurement].slice(-1000);
    const rule = s.thresholds.find(
      (t) => t.itemRef === action.ref && t.metric === action.metric,
    );
    const crossing = (limit: number) =>
      rule?.direction === "below" ? action.value < limit : action.value > limit;
    const existing = s.incidents.find(
      (i) =>
        i.itemRef === action.ref &&
        i.metric === action.metric &&
        i.status !== "resolved",
    );
    if (rule && existing && crossing(rule.critical))
      existing.severity = "critical";
    if (
      rule &&
      crossing(rule.warning) &&
      !s.incidents.some(
        (i) =>
          i.itemRef === action.ref &&
          i.metric === action.metric &&
          i.status !== "resolved",
      )
    )
      s.incidents = [
        ...s.incidents,
        incident.parse({
          id: crypto.randomUUID(),
          itemRef: action.ref,
          metric: action.metric,
          severity: crossing(rule.critical) ? "critical" : "warning",
          message: `Simulated ${action.metric} crossed the configured ${rule.direction} threshold.`,
          status: "open",
          at: now,
          acknowledgedBy: null,
          notificationRecorded: s.settings.notifications,
        }),
      ].slice(-200);
  } else if (action.type === "threshold") {
    item(action.ref);
    if (
      !Number.isFinite(action.warning) ||
      !Number.isFinite(action.critical) ||
      (action.direction === "above"
        ? action.critical <= action.warning
        : action.critical >= action.warning)
    )
      throw Error("Set the critical threshold beyond the warning threshold.");
    s.thresholds = [
      ...s.thresholds.filter(
        (t) => t.itemRef !== action.ref || t.metric !== action.metric,
      ),
      {
        itemRef: action.ref,
        metric: action.metric,
        warning: action.warning,
        critical: action.critical,
        direction: action.direction,
      },
    ];
  } else if (action.type === "incident") {
    const row = s.incidents.find((i) => i.id === action.id);
    if (!row) throw Error("Demo incident not found.");
    row.status = action.status;
    if (action.status === "acknowledged") row.acknowledgedBy = role;
  } else if (action.type === "user") {
    const u = {
      id: action.id ?? crypto.randomUUID(),
      name: text.parse(action.name),
      role: sandboxRole.parse(action.role),
    };
    if (action.id && !s.users.some((v) => v.id === action.id))
      throw Error("Demo user not found.");
    s.users = action.id
      ? s.users.map((v) => (v.id === action.id ? u : v))
      : [...s.users, u];
  } else if (action.type === "firmware")
    s.firmware.push({
      id: crypto.randomUUID(),
      version: z.string().trim().min(1).max(64).parse(action.version),
      at: now,
    });
  else if (action.type === "deploy") {
    item(action.ref);
    if (!s.firmware.some((f) => f.version === action.version))
      throw Error("Add sample firmware metadata first.");
    s.deployments.push({
      id: crypto.randomUUID(),
      itemRef: action.ref,
      version: action.version,
      status: "queued",
      at: now,
    });
  } else if (action.type === "completeDeployment") {
    const d = s.deployments.find((d) => d.id === action.id);
    if (!d) throw Error("Demo deployment not found.");
    d.status = "completed";
  } else if (action.type === "finding") {
    item(action.ref);
    s.findings.push({
      id: crypto.randomUUID(),
      itemRef: action.ref,
      title: "Simulated software review finding",
      state: "open",
      decision: "",
      at: now,
    });
  } else if (action.type === "decision") {
    const f = s.findings.find((f) => f.id === action.id);
    if (!f) throw Error("Demo finding not found.");
    f.decision = z.string().trim().min(1).max(1000).parse(action.decision);
    f.state = action.state;
  } else if (action.type === "scenario") s.scenario = action.scenario;
  else if (action.type === "settings") s.settings = action.settings;
  if (action.type === "item.save" || action.type === "item.connect") {
    for (const after of s.items) {
      const before = source.items.find((i) => i.ref === after.ref);
      if (!before || JSON.stringify(before) === JSON.stringify(after)) continue;
      for (const factory of s.factories)
        if (
          factory.draft.document.placements.some((p) => p.ref === after.ref)
        ) {
          appendDemoFactoryActivity(
            s,
            role,
            factory.id,
            "inventory.updated",
            after.ref,
            {
              name: before.name,
              identifier: before.identifier,
              itemType: before.itemType,
              zone: before.zone,
              connected: before.connected,
            },
            {
              name: after.name,
              identifier: after.identifier,
              itemType: after.itemType,
              zone: after.zone,
              connected: after.connected,
            },
          );
        }
    }
  }
  if (
    !action.type.startsWith("factory.") &&
    !["item.save", "item.connect"].includes(action.type)
  ) {
    const itemRef =
      "ref" in action && typeof action.ref === "string"
        ? action.ref
        : "id" in action && typeof action.id === "string"
          ? (source.incidents.find((i) => i.id === action.id)?.itemRef ??
            source.findings.find((i) => i.id === action.id)?.itemRef ??
            source.deployments.find((i) => i.id === action.id)?.itemRef)
          : undefined;
    if (itemRef)
      for (const factory of s.factories.filter((f) =>
        f.draft.document.placements.some((p) => p.ref === itemRef),
      )) {
        const field =
          action.type === "threshold"
            ? "thresholds"
            : action.type === "incident"
              ? "incidents"
              : ["finding", "decision"].includes(action.type)
                ? "findings"
                : ["deploy", "completeDeployment"].includes(action.type)
                  ? "deployments"
                  : null;
        if (field) {
          const rows = (state: DemoSandbox) =>
            state[
              field as "thresholds" | "incidents" | "findings" | "deployments"
            ]
              .filter((row) => row.itemRef === itemRef)
              .map((row) =>
                Object.fromEntries(
                  Object.entries(row).filter(
                    ([key]) => !["message", "title", "decision"].includes(key),
                  ),
                ),
              );
          appendDemoFactoryActivity(
            s,
            role,
            factory.id,
            action.type + ".changed",
            itemRef,
            { records: rows(source) },
            { records: rows(s) },
          );
        }
      }
  }
  s.updatedAt = now;
  s.audit = [
    ...s.audit,
    { id: crypto.randomUUID(), at: now, role, action: action.type },
  ].slice(-250);
  return demoSandbox.parse(s);
}

/** Latest per metric, including unsorted backups; a later appended sample wins ties. */
export function latestSandboxSamples(s: DemoSandbox, itemRef: string) {
  const latest = new Map<Metric, DemoSandbox["samples"][number]>();
  for (const sample of s.samples) {
    if (sample.itemRef !== itemRef) continue;
    const previous = latest.get(sample.metric);
    if (!previous || Date.parse(sample.at) >= Date.parse(previous.at))
      latest.set(sample.metric, sample);
  }
  return [...latest.values()].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  );
}

export function sandboxInventory(s: DemoSandbox): InventoryItem[] {
  return s.items.map((i) => {
    const samples = latestSandboxSamples(s, i.ref);
    const readings = Object.fromEntries(
      metrics.flatMap((m) => {
        const p = samples.find((p) => p.metric === m);
        return p ? [[m, p.value]] : [];
      }),
    );
    const measurements = Object.fromEntries(
      metrics.flatMap((m) => {
        const p = samples.find((p) => p.metric === m);
        return p
          ? [
              [
                m,
                {
                  sourceValue: p.value,
                  sourceUnit: p.unit,
                  canonicalValue: p.value,
                  canonicalUnit: p.unit,
                  conversionVersion: "sf-units-v1",
                  quality: "good",
                },
              ],
            ]
          : [];
      }),
    );
    return {
      ref: i.ref,
      kind: i.kind,
      id: i.ref.split(":").slice(1).join(":"),
      name: i.name,
      identifier: i.identifier,
      itemType: i.itemType,
      location: i.zone,
      zone: i.zone,
      configured: i.connected,
      isDemo: true,
      route: "Browser demo simulation",
      status: "unknown",
      lastObserved: null,
      sampleAt: samples[0] ? Date.parse(samples[0].at) : null,
      mode: "simulated",
      quality: samples.length ? "good" : "unknown",
      freshnessMs: null,
      lifecycle: "planned",
      aas: i.kind !== "device",
      equipmentId: i.equipmentId,
      firmware: null,
      values: readings,
      measurements,
      sandbox: true,
    } as InventoryItem;
  });
}

/** Read a previous browser workspace without changing the preserved v1 storage key. */
export function upgradeDemoSandbox(raw: unknown): DemoSandbox {
  const value = raw as Record<string, unknown> | null;
  return demoSandbox.parse(
    value?.version === 1 ? { ...value, version: 2 } : value,
  );
}
