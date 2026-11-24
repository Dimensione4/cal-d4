import { test } from "node:test";
import assert from "node:assert/strict";
import { planSends, decideSend, afterFailure, type CalBooking } from "../src/plan.ts";
import type { Rule, Send } from "../src/store.ts";

const NOW = new Date("2026-11-25T10:00:00Z");
const rule = (p: Partial<Rule> = {}): Rule => ({
  id: 1, name: "R24", channel: "email", trigger: "before_start", offsetMin: 1440, eventTypeIds: [],
  subject: "s", body: "b", bodyRescheduled: "", active: true,
  createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", ...p,
});
const booking = (p: Partial<CalBooking> = {}): CalBooking => ({
  uid: "b1", status: "accepted", startTime: "2026-11-27T10:00:00.000Z", endTime: "2026-11-27T10:30:00.000Z",
  createdAt: "2026-11-20T08:00:00.000Z", eventTypeId: 1, title: "Call", fromReschedule: null,
  responses: {}, location: null, metadata: {},
  attendee: { name: "Sara Rossi", email: "sara@example.it", timeZone: "Europe/Rome", phoneNumber: null }, ...p,
});
const send = (p: Partial<Send> = {}): Send => ({
  id: 7, bookingUid: "b1", ruleId: 1, dueAt: "2026-11-25T09:55:00.000Z", bookingStart: "2026-11-27T10:00:00.000Z",
  status: "pending", reason: "", attempts: 0, toAddr: "sara@example.it",
  createdAt: "2026-11-20T08:00:00.000Z", updatedAt: "2026-11-20T08:00:00.000Z", ...p,
});
const plan = (b: CalBooking[], r: Rule[], ex = new Map<string, Send>()) => planSends(b, r, ex, NOW);

test("24 ore prima: insert pending con la scadenza giusta", () => {
  const { inserts } = plan([booking()], [rule()]);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].status, "pending");
  assert.equal(inserts[0].dueAt, "2026-11-26T10:00:00.000Z");
  assert.equal(inserts[0].bookingStart, "2026-11-27T10:00:00.000Z");
  assert.equal(inserts[0].toAddr, "sara@example.it");
});

test("prenotazione troppo vicina: insert skipped 'troppo tardi'", () => {
  const { inserts } = plan([booking({ startTime: "2026-11-25T20:00:00.000Z" })], [rule()]);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].status, "skipped");
  assert.equal(inserts[0].reason, "troppo tardi");
});

test("prenotazione annullata o senza email: niente", () => {
  assert.equal(plan([booking({ status: "cancelled" })], [rule()]).inserts.length, 0);
  assert.equal(plan([booking({ attendee: null })], [rule()]).inserts.length, 0);
});

test("regola subito: niente ondata per prenotazioni precedenti alla regola", () => {
  const r = rule({ trigger: "after_booking", offsetMin: 0, createdAt: "2026-11-25T09:00:00.000Z" });
  assert.equal(plan([booking({ createdAt: "2026-11-24T08:00:00.000Z" })], [r]).inserts.length, 0);
  const { inserts } = plan([booking({ createdAt: "2026-11-25T09:30:00.000Z" })], [r]);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].dueAt, "2026-11-25T09:30:00.000Z");
  assert.equal(inserts[0].status, "pending");
});

test("tipi di evento, regola inattiva, canale whatsapp: niente", () => {
  assert.equal(plan([booking()], [rule({ eventTypeIds: [3] })]).inserts.length, 0);
  assert.equal(plan([booking()], [rule({ eventTypeIds: [1] })]).inserts.length, 1);
  assert.equal(plan([booking()], [rule({ active: false })]).inserts.length, 0);
  assert.equal(plan([booking()], [rule({ channel: "whatsapp" })]).inserts.length, 0);
});

test("invio già presente: nessun nuovo insert; orario cambiato: reschedule", () => {
  const ex = new Map([["b1|1", send()]]);
  assert.deepEqual(plan([booking()], [rule()], ex), { inserts: [], reschedules: [] });
  const moved = plan([booking({ startTime: "2026-11-28T10:00:00.000Z" })], [rule()], ex);
  assert.deepEqual(moved.reschedules, [{ id: 7, dueAt: "2026-11-27T10:00:00.000Z", bookingStart: "2026-11-28T10:00:00.000Z" }]);
});

test("call spostata: il nuovo uid riceve i suoi promemoria", () => {
  const ex = new Map([["b1|1", send()]]);
  const { inserts } = plan([booking({ status: "cancelled" }), booking({ uid: "b2", fromReschedule: "b1", startTime: "2026-11-29T10:00:00.000Z" })], [rule()], ex);
  assert.deepEqual(inserts.map((i) => [i.bookingUid, i.dueAt]), [["b2", "2026-11-28T10:00:00.000Z"]]);
});

test("decideSend", () => {
  assert.deepEqual(decideSend(send(), undefined, NOW), { action: "skip", reason: "annullata" });
  assert.deepEqual(decideSend(send(), booking({ status: "cancelled" }), NOW), { action: "skip", reason: "annullata" });
  assert.deepEqual(decideSend(send(), booking({ startTime: "2026-11-28T10:00:00.000Z" }), NOW), { action: "skip", reason: "orario cambiato" });
  assert.deepEqual(decideSend(send({ dueAt: "2026-11-25T09:49:00.000Z" }), booking(), NOW), { action: "skip", reason: "in ritardo" });
  assert.deepEqual(decideSend(send(), booking(), NOW), { action: "send" });
});

test("afterFailure", () => {
  assert.deepEqual(afterFailure(send(), NOW, true), { status: "pending", attempts: 1 });
  assert.deepEqual(afterFailure(send({ attempts: 1 }), NOW, true), { status: "failed", attempts: 2 });
  assert.deepEqual(afterFailure(send(), NOW, false), { status: "failed", attempts: 1 });
  assert.deepEqual(afterFailure(send({ dueAt: "2026-11-25T09:49:00.000Z" }), NOW, true), { status: "failed", attempts: 1 });
});
