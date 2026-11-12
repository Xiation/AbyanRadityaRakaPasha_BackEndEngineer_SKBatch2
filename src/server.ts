import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db/index.ts";

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const db = openDb(config.DB_PATH);
const server = createApp(db, { logger: (line) => console.log(line) }).listen(config.PORT, () => {
  console.log(`API listening on http://localhost:${config.PORT}`);
});

// Graceful shutdown: stop accepting connections, let in-flight requests finish, then close the database
// so the SQLite file is left clean. A hard timeout makes sure a stuck connection cannot block shutdown forever.
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    db.close();
    console.log("shutdown complete");
    process.exit(0);
  });
  server.closeIdleConnections(); // keep-alive connections with no request in flight
  setTimeout(() => {
    console.error("shutdown timed out, forcing exit");
    process.exit(1);
  }, 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
