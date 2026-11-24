import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { openStore } from "./store.ts";
import { createCal } from "./cal.ts";
import { createMailer } from "./mail.ts";
import { runCycle, checkAlarm, recoverInterrupted, type Deps } from "./loop.ts";
import { createServer } from "./web.ts";

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
const cfg = loadConfig();
mkdirSync(cfg.dataDir, { recursive: true });
const store = openStore(join(cfg.dataDir, "avvisi.db"));
store.seedDefaults();
recoverInterrupted(store);
store.setMeta("started_at", new Date().toISOString());

const cal = createCal(cfg.calDatabaseUrl);
const mailer = createMailer(cfg);
const now = () => new Date();
const deps: Deps = { store, cal, mailer, cfg, now, log };
const server = createServer({ store, cfg, mailer, now }).listen(cfg.port, () => log(`D4 Avvisi in ascolto sulla porta ${cfg.port}`));

let busy = false;
async function tick() {
  if (busy) return; // ponytail: un giro alla volta, se uno dura più di 60 s il successivo salta
  busy = true;
  try {
    await runCycle(deps);
  } catch (e) {
    const msg = String((e as any)?.message ?? e).slice(0, 200);
    store.setMeta("last_error", `${new Date().toISOString()} ${msg}`);
    log(`giro non riuscito: ${msg}`);
  } finally {
    await checkAlarm(deps);
    busy = false;
  }
}
void tick();
const timer = setInterval(tick, 60_000);

process.on("SIGTERM", () => {
  log("arresto");
  clearInterval(timer);
  server.close();
  void cal.close().finally(() => { store.close(); process.exit(0); });
});
