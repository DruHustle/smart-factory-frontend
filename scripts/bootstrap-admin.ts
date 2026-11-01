import "dotenv/config";
import { closeDatabase } from "../server/db";
import { bootstrapAdministrator } from "../server/bootstrapAdmin";

// Run only as an audited private deployment task with temporary environment secrets.
try {
  const id = await bootstrapAdministrator({
    email: process.env.BOOTSTRAP_ADMIN_EMAIL ?? "",
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "",
    name: process.env.BOOTSTRAP_ADMIN_NAME,
  });
  console.log(
    `Administrator account ready (ID ${id}). Remove the temporary bootstrap secrets.`,
  );
} finally {
  await closeDatabase();
}
