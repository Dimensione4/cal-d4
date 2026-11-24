import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.ts";
import { runCycle, checkAlarm, recoverInterrupted } from "../src/loop.ts";
import type { CalBooking } from "../src/plan.ts";
import type { Config } from "../src/config.ts";

const cfg = { calWebappUrl: "https://cal.dimensione4.it", tzDefault: "Europe/Rome", alarmEmail: "dario@example.it" } as Config;
const booking = (p: Partial<CalBooking> = {}): CalBooking => ({
  uid: "b1", status: "accepted", startTime: "2026-11-27T10:00:00.000Z", endTime: "2026-11-27T10:30:00.000Z",
  createdAt: "2026-11-20T08:00:00.000Z", eventTypeId: 1, title: "Call", fromReschedule: null,
  responses: {}, location: null, metadata: {},
  attendee: { name: "Sara Rossi", email: "sara@example.it", timeZone: "Europe/Rome", phoneNumber: null }, ...p,
});

function setup() {
  const store = openStore(":memory:");
  store.saveRule({ name: "R24", channel: "email", trigger: "before_start", offsetMin: 1440, eventTypeIds: [],
    subject: "Promemoria {titolo}", body: "Ciao {nome}", bodyRescheduled: "", active: true });
  const bookings = new Map<string, CalBooking>([["b1", booking()]]);
  let calDown = false;
  const cal = {
    listWindow: async () => { if (calDown) throw new Error("connessione rifiutata"); return [...bookings.values()]; },
    get: async (uid: string) => bookings.get(uid),
  };
  const sent: { to: string; subject: string }[] = [];
  let failNext: { temporary: boolean } | null = null;
  const mailer = {
    send: async (to: string, m: { subject: string }) => {
      if (failNext) { const e: any = new Error("smtp"); e.temporary = failNext.temporary; failNext = null; throw e; }
      sent.push({ to, subject: m.subject });
    },
  };
  let now = new Date("2026-11-26T10:01:00Z");
  const deps = { store, cal, mailer, cfg, now: () => now, log: () => {} };
  return {
    deps, store, bookings, sent,
    setNow: (s: string) => { now = new Date(s); },
    failOnce: (temporary: boolean) => { failNext = { temporary }; },
    setCalDown: (v: boolean) => { calDown = v; },
  };
}

test("promemoria scaduto: una email, poi nessun doppione", async () => {
  const t = setup();
  await runCycle(t.deps);
  assert.deepEqual(t.sent, [{ to: "sara@example.it", subject: "Promemoria Call" }]);
  assert.equal(t.store.listSends(5)[0].status, "sent");
  await runCycle(t.deps);
  assert.equal(t.sent.length, 1);
});

test("annullata tra pianificazione e invio: nessuna email", async () => {
  const t = setup();
  t.setNow("2026-11-26T09:00:00Z");
  await runCycle(t.deps);
  assert.equal(t.store.listSends(5)[0].status, "pending");
  t.bookings.set("b1", booking({ status: "cancelled" }));
  t.setNow("2026-11-26T10:01:00Z");
  await runCycle(t.deps);
  assert.equal(t.sent.length, 0);
  assert.deepEqual([t.store.listSends(5)[0].status, t.store.listSends(5)[0].reason], ["skipped", "annullata"]);
});

test("errore temporaneo: ritenta al giro dopo", async () => {
  const t = setup();
  t.failOnce(true);
  await runCycle(t.deps);
  assert.deepEqual([t.store.listSends(5)[0].status, t.store.listSends(5)[0].attempts], ["pending", 1]);
  await runCycle(t.deps);
  assert.equal(t.store.listSends(5)[0].status, "sent");
  assert.equal(t.sent.length, 1);
});

test("errore definitivo: failed con motivo", async () => {
  const t = setup();
  t.failOnce(false);
  await runCycle(t.deps);
  assert.equal(t.store.listSends(5)[0].status, "failed");
  assert.ok(t.store.listSends(5)[0].reason.includes("smtp"));
});

test("Cal irraggiungibile: il giro fallisce e last_ok non cambia", async () => {
  const t = setup();
  t.store.setMeta("last_ok", "2026-11-26T09:00:00.000Z");
  t.setCalDown(true);
  await assert.rejects(runCycle(t.deps));
  assert.equal(t.store.getMeta("last_ok"), "2026-11-26T09:00:00.000Z");
  t.setCalDown(false);
  await runCycle(t.deps);
  assert.equal(t.store.getMeta("last_ok"), "2026-11-26T10:01:00.000Z");
});

test("allarme dopo 10 minuti senza giri riusciti, al massimo uno ogni 6 ore", async () => {
  const t = setup();
  t.store.setMeta("last_ok", "2026-11-26T09:50:00.000Z");
  await checkAlarm(t.deps);
  assert.deepEqual(t.sent.map((s) => [s.to, s.subject]), [["dario@example.it", "D4 Avvisi: non riesco a lavorare"]]);
  await checkAlarm(t.deps);
  assert.equal(t.sent.length, 1);
  t.setNow("2026-11-26T16:02:00Z");
  await checkAlarm(t.deps);
  assert.equal(t.sent.length, 2);
});

test("niente allarme se l'ultimo giro è recente", async () => {
  const t = setup();
  t.store.setMeta("last_ok", "2026-11-26T09:55:00.000Z");
  await checkAlarm(t.deps);
  assert.equal(t.sent.length, 0);
});

test("invii rimasti a metà all'avvio diventano failed 'interrotto'", async () => {
  const t = setup();
  t.setNow("2026-11-26T09:00:00Z");
  await runCycle(t.deps);
  const s = t.store.listSends(5)[0];
  t.store.updateSend(s.id, { status: "sending" });
  recoverInterrupted(t.store);
  assert.deepEqual([t.store.listSends(5)[0].status, t.store.listSends(5)[0].reason], ["failed", "interrotto"]);
});

test("call annullata: i suoi invii in attesa diventano subito saltati", async () => {
  const t = setup();
  t.setNow("2026-11-26T09:00:00Z");
  await runCycle(t.deps);
  t.bookings.set("b1", booking({ status: "cancelled" }));
  t.setNow("2026-11-26T09:01:00Z");
  await runCycle(t.deps);
  assert.deepEqual([t.store.listSends(5)[0].status, t.store.listSends(5)[0].reason], ["skipped", "annullata"]);
  assert.equal(t.sent.length, 0);
});

test("regola salvata durante un giro: nessuna email doppia", async () => {
  const t = setup();
  const get = t.deps.cal.get;
  let once = true;
  t.deps.cal.get = async (uid: string) => {
    if (once) { once = false; t.store.deletePendingForRule(1); } // Dario salva la regola mentre il giro aspetta Cal
    return get(uid);
  };
  await runCycle(t.deps);
  await runCycle(t.deps);
  assert.equal(t.sent.length, 1);
});
