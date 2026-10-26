import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  packageManifestSchema,
  localBindingSchema,
} from "../../server/equipment/packages";
import { workSchema } from "../../server/equipment/local";
await mkdir("contracts/equipment", { recursive: true });
for (const [name, schema] of Object.entries({
  "model-package": packageManifestSchema,
  "saved-work": workSchema,
  "source-binding": localBindingSchema,
})) {
  const text =
      JSON.stringify(
        {
          ...z.toJSONSchema(schema),
          $id: "urn:smart-factory:equipment:" + name + ":1",
        },
        null,
        2,
      ) + "\n",
    file = "contracts/equipment/" + name + ".schema.json";
  if (process.argv.includes("--check")) {
    if ((await readFile(file, "utf8")) !== text)
      throw new Error("Local schema drift: " + file);
  } else await writeFile(file, text);
}
console.log("App-owned equipment schemas verified");
