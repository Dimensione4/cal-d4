import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.ts";
import { loadConfig } from "../src/config.ts";

const baseRule = {
  name: "R", channel: "email" as const, trigger: "before_start" as const, offsetMin: 60,
  eventTypeIds: [1, 3], subject: "s", body: "b", bodyRescheduled: "", active: true,
};
const baseSend = {
  bookingUid: "u1", ruleId: 1, dueAt: "2026-11-25T09:59:00.000Z", bookingStart: "2026-11-25T11:00:00.000Z",
  status: "pending" as const, reason: "", attempts: 0, toAddr: "a@b.it",
};

test("saveRule poi getRule restituisce gli stessi campi", () => {
  const s = openStore(":memory:");
  const r = s.saveRule(baseRule);
  const g = s.getRule(r.id)!;
  assert.deepEqual(g.eventTypeIds, [1, 3]);
  assert.equal(g.name, "R");
  assert.equal(g.active, true);
  assert.equal(g.offsetMin, 60);
  assert.ok(g.createdAt && g.updatedAt);
});

test("insertSend duplicato viene ignorato", () => {
  const s = openStore(":memory:");
  s.saveRule(baseRule);
  s.insertSend(baseSend);
  s.insertSend(baseSend);
  assert.equal(s.listSends(10).length, 1);
  assert.ok(s.sendsByKey().has("u1|1"));
});

test("deletePendingForRule cancella solo i pending di quella regola", () => {
  const s = openStore(":memory:");
  s.saveRule(baseRule);
  s.insertSend(baseSend);
  s.insertSend({ ...baseSend, bookingUid: "u2", status: "sent" });
  assert.equal(s.deletePendingForRule(1), 1);
  assert.deepEqual(s.listSends(10).map((x) => x.bookingUid), ["u2"]);
});

test("dueSends filtra per stato e scadenza", () => {
  const s = openStore(":memory:");
  s.saveRule(baseRule);
  s.insertSend(baseSend);
  s.insertSend({ ...baseSend, bookingUid: "u2", dueAt: "2026-11-25T10:01:00.000Z" });
  s.insertSend({ ...baseSend, bookingUid: "u3", status: "sent" });
  assert.deepEqual(s.dueSends("2026-11-25T10:00:00.000Z").map((x) => x.bookingUid), ["u1"]);
});

test("updateSend e meta", () => {
  const s = openStore(":memory:");
  s.saveRule(baseRule);
  s.insertSend(baseSend);
  const id = s.listSends(1)[0].id;
  s.updateSend(id, { status: "sent", attempts: 1 });
  assert.equal(s.listSends(1)[0].status, "sent");
  assert.equal(s.getMeta("x"), undefined);
  s.setMeta("x", "1");
  assert.equal(s.getMeta("x"), "1");
});

test("seedDefaults crea una regola email 24 ore prima, una volta sola", () => {
  const s = openStore(":memory:");
  s.seedDefaults();
  s.seedDefaults();
  const rules = s.listRules();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].name, "Email 24 ore prima");
  assert.equal(rules[0].channel, "email");
  assert.equal(rules[0].trigger, "before_start");
  assert.equal(rules[0].offsetMin, 1440);
  assert.equal(rules[0].active, true);
});

test("loadConfig segnala le variabili mancanti", () => {
  assert.throws(() => loadConfig({}), /CAL_DATABASE_URL/);
});
