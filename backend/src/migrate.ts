import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./db/client.js";

const url = process.env.DATABASE_URL?.trim();
if (!url) throw new Error("DATABASE_URL is required.");

const db = createDb(url);
try {
  await migrate(db.db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  console.log("migrations applied");
} finally {
  await db.close();
}
