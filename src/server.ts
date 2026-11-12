import { createApp } from "./app.ts";
import { openDb } from "./db/index.ts";

const port = Number(process.env.PORT ?? 3000);
const db = openDb(process.env.DB_PATH ?? "applicants.db");

createApp(db).listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
