import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { openStore } from "../src/store.ts";
import { createServer } from "../src/web.ts";
import type { Config } from "../src/config.ts";

const cfg = { adminPassword: "giusta-123", sessionSecret: "s".repeat(32), calWebappUrl: "https://cal.dimensione4.it", tzDefault: "Europe/Rome" } as Config;
const NOW = new Date("2026-11-26T10:00:00Z");
const store = openStore(":memory:");
store.seedDefaults();
const mails: { to: string; subject: string }[] = [];
const server = createServer({ store, cfg, mailer: { send: async (to, m) => { mails.push({ to, subject: m.subject }); } }, now: () => NOW });
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const form = (o: Record<string, string>) => ({
  method: "POST", redirect: "manual" as const,
  headers: { "content-type": "application/x-www-form-urlencoded", cookie: "" }, body: new URLSearchParams(o).toString(),
});
let cookie = "";
const authed = (init: any = {}) => ({ redirect: "manual" as const, ...init, headers: { ...(init.headers ?? {}), cookie } });
const ruleForm = (name: string) => ({ name, trigger: "before_start", quanto: "2", unita: "ore", eventi: "", subject: "Ogg {nome}", body: "Corpo {ora}", bodyRescheduled: "", active: "on" });

test("senza login si va al login", async () => {
  const r = await fetch(`${base}/`, { redirect: "manual" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/login");
});

test("login: password sbagliata 401, giusta imposta il cookie", async () => {
  assert.equal((await fetch(`${base}/login`, form({ password: "no" }))).status, 401);
  const r = await fetch(`${base}/login`, form({ password: "giusta-123" }));
  assert.equal(r.status, 302);
  const sc = r.headers.get("set-cookie") ?? "";
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Strict/);
  cookie = sc.split(";")[0];
  assert.equal((await fetch(`${base}/`, authed())).status, 200);
});

test("cookie falsificato rifiutato", async () => {
  const r = await fetch(`${base}/`, { redirect: "manual", headers: { cookie: "avvisi_s=9999999999999.abc" } });
  assert.equal(r.status, 302);
});

test("crea regola, poi salvarla cancella i suoi invii in attesa", async () => {
  const r = await fetch(`${base}/regole/nuova`, authed(form(ruleForm("Due ore prima"))));
  assert.equal(r.status, 302);
  const rule = store.listRules().find((x) => x.name === "Due ore prima")!;
  assert.equal(rule.offsetMin, 120);
  assert.equal(rule.trigger, "before_start");
  store.insertSend({ bookingUid: "u1", ruleId: rule.id, dueAt: "2026-11-27T08:00:00.000Z", bookingStart: "2026-11-27T10:00:00.000Z", status: "pending", reason: "", attempts: 0, toAddr: "a@b.it" });
  await fetch(`${base}/regole/${rule.id}`, authed(form({ ...ruleForm("Due ore prima"), quanto: "3" })));
  assert.equal(store.getRule(rule.id)!.offsetMin, 180);
  assert.equal(store.listSends(10, "u1").length, 0);
});

test("campi non validi: 400 e nessuna regola", async () => {
  const n = store.listRules().length;
  const r = await fetch(`${base}/regole/nuova`, authed(form({ ...ruleForm(""), body: "" })));
  assert.equal(r.status, 400);
  assert.equal(store.listRules().length, n);
});

test("attiva/disattiva inverte lo stato", async () => {
  const id = store.listRules()[0].id;
  const before = store.getRule(id)!.active;
  await fetch(`${base}/regole/${id}/attiva`, authed({ method: "POST" }));
  assert.equal(store.getRule(id)!.active, !before);
});

test("health: 200 se l'ultimo giro è recente, 503 se no", async () => {
  store.setMeta("last_ok", "2026-11-26T09:59:00.000Z");
  assert.equal((await fetch(`${base}/health`)).status, 200);
  store.setMeta("last_ok", "2026-11-26T09:55:00.000Z");
  assert.equal((await fetch(`${base}/health`)).status, 503);
});

test("i valori sono escapati", async () => {
  await fetch(`${base}/regole/nuova`, authed(form(ruleForm("<script>x</script>"))));
  const html = await (await fetch(`${base}/`, authed())).text();
  assert.ok(html.includes("&lt;script&gt;x&lt;/script&gt;"));
  assert.ok(!html.includes("<script>x</script>"));
});

test("prova: manda l'email della regola all'indirizzo dato", async () => {
  const id = store.listRules()[0].id;
  const r = await fetch(`${base}/prova`, authed(form({ ruleId: String(id), email: "dario@example.it" })));
  assert.equal(r.status, 302);
  assert.equal(mails.at(-1)!.to, "dario@example.it");
});

test("storico filtrato per prenotazione", async () => {
  store.insertSend({ bookingUid: "zz9", ruleId: 1, dueAt: "2026-11-27T08:00:00.000Z", bookingStart: "2026-11-27T10:00:00.000Z", status: "sent", reason: "", attempts: 1, toAddr: "z@b.it" });
  const html = await (await fetch(`${base}/storico?uid=zz9`, authed())).text();
  assert.ok(html.includes("z@b.it"));
});
