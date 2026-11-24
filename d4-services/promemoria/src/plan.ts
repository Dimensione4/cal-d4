import type { Rule, Send, SendInput } from "./store.ts";

export type CalBooking = {
  uid: string; status: "accepted" | "cancelled" | "rejected" | "pending" | "awaiting_host";
  startTime: string; endTime: string; createdAt: string; eventTypeId: number | null; title: string;
  fromReschedule: string | null; responses: unknown; location: string | null; metadata: unknown;
  attendee: { name: string; email: string; timeZone: string; phoneNumber: string | null } | null;
};

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: string) => new Date(s).getTime();

function dueAt(rule: Rule, b: CalBooking): string {
  return rule.trigger === "after_booking" ? iso(ms(b.createdAt)) : iso(ms(b.startTime) - rule.offsetMin * MIN);
}

export function planSends(bookings: CalBooking[], rules: Rule[], existing: Map<string, Send>, now: Date, graceMin = 10) {
  const inserts: SendInput[] = [];
  const reschedules: { id: number; dueAt: string; bookingStart: string }[] = [];
  const active = rules.filter((r) => r.active && r.channel === "email"); // ponytail: fase 1 solo email
  for (const b of bookings) {
    if (b.status !== "accepted" || !b.attendee?.email) continue;
    for (const r of active) {
      if (r.eventTypeIds.length && (b.eventTypeId == null || !r.eventTypeIds.includes(b.eventTypeId))) continue;
      if (r.trigger === "after_booking" && ms(b.createdAt) < ms(r.createdAt)) continue;
      const due = dueAt(r, b);
      const prev = existing.get(`${b.uid}|${r.id}`);
      if (prev) {
        if (prev.status === "pending" && prev.bookingStart !== b.startTime) reschedules.push({ id: prev.id, dueAt: due, bookingStart: b.startTime });
        continue;
      }
      const late = r.trigger === "before_start" && ms(due) < now.getTime() - graceMin * MIN;
      inserts.push({
        bookingUid: b.uid, ruleId: r.id, dueAt: due, bookingStart: b.startTime,
        status: late ? "skipped" : "pending", reason: late ? "troppo tardi" : "", attempts: 0, toAddr: b.attendee.email,
      });
    }
  }
  return { inserts, reschedules };
}

export function decideSend(send: Send, b: CalBooking | undefined, now: Date, graceMin = 10):
  { action: "send" } | { action: "skip"; reason: string } {
  if (!b || b.status !== "accepted") return { action: "skip", reason: "annullata" };
  if (b.startTime !== send.bookingStart) return { action: "skip", reason: "orario cambiato" };
  if (now.getTime() > ms(send.dueAt) + graceMin * MIN) return { action: "skip", reason: "in ritardo" };
  return { action: "send" };
}

export function afterFailure(send: Send, now: Date, temporary: boolean, graceMin = 10): { status: "pending" | "failed"; attempts: number } {
  const attempts = send.attempts + 1;
  const retry = temporary && send.attempts === 0 && now.getTime() <= ms(send.dueAt) + graceMin * MIN;
  return { status: retry ? "pending" : "failed", attempts };
}
