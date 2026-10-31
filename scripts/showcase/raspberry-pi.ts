/** Additive authored example. Existing readings, evidence and timestamps are retained. */
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import {
  createEquipment,
  template,
  raspberryPiRevision,
} from "../../server/equipment/local";
import type { Showcase } from "../../shared/showcase";
import { showcaseUuid as uuid } from "./basic";

export const raspberryPiShowcaseId = uuid("raspberry-pi-4b-v3");
export async function addRaspberryPiShowcase(
  base: Showcase,
): Promise<Showcase> {
  const db = (await getDb())!;
  const ref = `equipment:${raspberryPiShowcaseId}`;
  const [retained] = await db.execute<{
    is_demo: boolean;
    template_revision: string;
  }>(
    sql`select is_demo,template_revision from equipment_workspaces where id=${raspberryPiShowcaseId}`,
  );
  if (
    retained &&
    (!retained.is_demo || retained.template_revision !== raspberryPiRevision)
  )
    throw Error(
      "Reserved Raspberry Pi example identity is already in use. Nothing was replaced.",
    );
  if (base.version >= 3 && base.raspberryPiRef === ref && retained) return base;
  const t = await template(raspberryPiRevision);
  await createEquipment(
    {
      name: "Showcase Raspberry Pi 4 Model B",
      serialNumber: "SIM-RPI-4B-01",
      kind: "simulated",
      templateRevision: t.revision,
      zone: "Showcase",
    },
    0,
    {
      id: raspberryPiShowcaseId,
      assetId: "urn:smart-factory:showcase:raspberry-pi-4b",
      isDemo: true,
      components: t.components.map((c) =>
        uuid("raspberry-pi:" + c.templateComponentId),
      ),
    },
  );
  await db.transaction(async (tx) => {
    const [asset] = await tx.execute<{ id: number }>(
      sql`select id from assets where "assetId"='urn:smart-factory:showcase:raspberry-pi-4b' and "isDemo"=true`,
    );
    const [gateway] = await tx.execute<{ id: number }>(
      sql`select id from devices where "deviceId"='smart-factory-public-simulator' and "isDemo"=true`,
    );
    if (!asset || !gateway)
      throw Error(
        "The isolated Raspberry Pi example requires its demo asset and gateway.",
      );
    await tx.execute(
      sql`insert into asset_devices("assetId","deviceId",protocol,"tagMappings") select ${asset.id},${gateway.id},'simulator','[]'::jsonb where not exists(select 1 from asset_devices where "assetId"=${asset.id} and "deviceId"=${gateway.id})`,
    );
    if (!retained) {
      const [w] = await tx.execute<{
        components: Array<{ name: string; installedComponentId: string }>;
      }>(
        sql`select components from equipment_workspaces where id=${raspberryPiShowcaseId} and is_demo=true`,
      );
      const cpu =
        w.components.find((c) => c.name === "BCM2711 processor package")
          ?.installedComponentId ?? null;
      await tx.execute(
        sql`update assets set location='Simulation edge cabinet',zone='Showcase' where id=${asset.id} and "isDemo"=true`,
      );
      await tx.execute(
        sql`update equipment_workspaces set selected_component=${cpu},viewpoints=${JSON.stringify(
          [
            {
              id: uuid("raspberry-pi:assembled-view"),
              name: "Board overview",
              eye: [0.14, 0.13, 0.16],
              target: [0, 0.02, 0],
            },
            {
              id: uuid("raspberry-pi:underside-view"),
              name: "MicroSD underside",
              eye: [-0.12, -0.09, 0.09],
              target: [0, 0.015, 0],
            },
          ],
        )}::jsonb where id=${raspberryPiShowcaseId} and is_demo=true`,
      );
    }
    const full: Showcase = {
      ...base,
      version: 3,
      raspberryPiRef: ref,
      chapters: [
        ...(base.chapters ?? []).filter(
          (c) => c.title !== "Raspberry Pi gateway",
        ),
        {
          title: "Raspberry Pi gateway",
          description:
            "Illustrative Pi 4 Model B with selectable board components, explosion, sections and saved views. No physical board is connected.",
          href: `/inventory/${ref}/3d`,
          state: "available",
        },
      ],
    };
    await tx.execute(
      sql`update system_settings set value=${JSON.stringify(full)}::jsonb where key='showcase_v1'`,
    );
  });
  const [stored] = await db.execute<{ value: Showcase }>(
    sql`select value from system_settings where key='showcase_v1'`,
  );
  return stored.value;
}
