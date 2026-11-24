import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingVars, fill, renderEmail } from "../src/render.ts";
import type { CalBooking } from "../src/plan.ts";
import type { Rule } from "../src/store.ts";

const W = "https://cal.dimensione4.it";
const b = (p: Partial<CalBooking> = {}): CalBooking => ({
  uid: "abc", status: "accepted", startTime: "2026-11-27T10:00:00.000Z", endTime: "2026-11-27T10:30:00.000Z",
  createdAt: "2026-11-20T08:00:00.000Z", eventTypeId: 1, title: "Call Conoscitiva", fromReschedule: null,
  responses: {}, location: "integrations:google:meet", metadata: {},
  attendee: { name: "Luca Bianchi", email: "l@example.it", timeZone: "Europe/Rome", phoneNumber: null }, ...p,
});
const rule: Rule = {
  id: 1, name: "R", channel: "email", trigger: "before_start", offsetMin: 1440, eventTypeIds: [],
  subject: "Promemoria {titolo} alle {ora}", body: "Ciao {nome}\nLink: {link_gestisci}", bodyRescheduled: "",
  active: true, createdAt: "", updatedAt: "",
};

test("nome e cognome da responses.name oggetto", () => {
  const v = bookingVars(b({ responses: { name: { firstName: "Sara", lastName: "Rossi" } } }), W, "Europe/Rome");
  assert.equal(v.nome, "Sara");
  assert.equal(v.cognome, "Rossi");
});

test("nome e cognome da stringa o da attendee", () => {
  const v = bookingVars(b({ responses: { name: "Mario De Luca" } }), W, "Europe/Rome");
  assert.deepEqual([v.nome, v.cognome], ["Mario", "De Luca"]);
  const w = bookingVars(b(), W, "Europe/Rome");
  assert.deepEqual([w.nome, w.cognome], ["Luca", "Bianchi"]);
});

test("data e ora nel fuso dell'ospite, 24h", () => {
  const v = bookingVars(b(), W, "Europe/Rome");
  assert.equal(v.data, "venerdì 27 novembre 2026");
  assert.equal(v.ora, "11:00");
  const t = bookingVars(b({ attendee: { name: "A", email: "a@b.it", timeZone: "", phoneNumber: null } }), W, "Europe/Rome");
  assert.equal(t.ora, "11:00");
});

test("link della call e di gestione", () => {
  assert.equal(bookingVars(b({ metadata: { videoCallUrl: "https://meet.google.com/x" } }), W, "Europe/Rome").link_call, "https://meet.google.com/x");
  assert.equal(bookingVars(b(), W, "Europe/Rome").link_call, "");
  assert.equal(bookingVars(b({ location: "https://zoom.us/j/1" }), W, "Europe/Rome").link_call, "https://zoom.us/j/1");
  assert.equal(bookingVars(b(), W, "Europe/Rome").link_gestisci, "https://cal.dimensione4.it/booking/abc");
});

test("fill lascia i segnaposti sconosciuti", () => {
  assert.equal(fill("Ciao {nome} {xyz}", { nome: "A" }), "Ciao A {xyz}");
});

test("HTML escapato, testo semplice no", () => {
  const m = renderEmail(rule, b({ attendee: { name: "<b>x</b> Y", email: "a@b.it", timeZone: "Europe/Rome", phoneNumber: null } }), W, "Europe/Rome");
  assert.ok(m.html.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.ok(!m.html.includes("<b>x</b>"));
  assert.ok(m.text.includes("<b>x</b>"));
  assert.equal(m.subject, "Promemoria Call Conoscitiva alle 11:00");
});

test("call spostata usa il testo alternativo", () => {
  const m = renderEmail({ ...rule, bodyRescheduled: "Spostata {ora}" }, b({ fromReschedule: "old" }), W, "Europe/Rome");
  assert.ok(m.text.includes("Spostata 11:00"));
  const n = renderEmail(rule, b({ fromReschedule: "old" }), W, "Europe/Rome");
  assert.ok(n.text.startsWith("Ciao Luca"));
});

test("HTML col brand D4 e link cliccabili", () => {
  const m = renderEmail(rule, b(), W, "Europe/Rome");
  for (const s of ["#05070A", "https://cal.dimensione4.it/emails/logo.png", "#25E4E4", '<a href="https://cal.dimensione4.it/booking/abc"']) assert.ok(m.html.includes(s), s);
  assert.ok(m.html.includes("Ciao Luca<br>"));
});
