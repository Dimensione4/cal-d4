import type { Config } from "./config.ts";
import type { Store } from "./store.ts";
import { planSends, decideSend, afterFailure, type CalBooking } from "./plan.ts";
import { renderEmail, emailHtml } from "./render.ts";

export type Mail = { subject: string; html: string; text: string };
export type Mailer = { send(to: string, m: Mail): Promise<void> };
export type CalReader = { listWindow(now: Date): Promise<CalBooking[]>; get(uid: string): Promise<CalBooking | undefined> };
export type Deps = { store: Store; cal: CalReader; mailer: Mailer; cfg: Config; now: () => Date; log: (msg: string) => void };

const MIN = 60_000;
const short = (e: unknown) => String((e as any)?.message ?? e).slice(0, 200);

export async function runCycle({ store, cal, mailer, cfg, now: clock, log }: Deps): Promise<void> {
  const now = clock();
  const bookings = await cal.listWindow(now);
  const existing = store.sendsByKey();
  const { inserts, reschedules } = planSends(bookings, store.listRules(), existing, now);
  const gone = new Set(bookings.filter((b) => b.status !== "accepted").map((b) => b.uid));
  for (const s of existing.values()) {
    if (s.status === "pending" && gone.has(s.bookingUid)) store.updateSend(s.id, { status: "skipped", reason: "annullata" });
  }
  for (const s of inserts) store.insertSend(s);
  for (const r of reschedules) store.updateSend(r.id, { dueAt: r.dueAt, bookingStart: r.bookingStart });

  for (const s of store.dueSends(now.toISOString())) {
    const b = await cal.get(s.bookingUid);
    const d = decideSend(s, b, now);
    if (d.action === "skip") { store.updateSend(s.id, { status: "skipped", reason: d.reason }); continue; }
    const rule = store.getRule(s.ruleId);
    if (!rule) { store.updateSend(s.id, { status: "skipped", reason: "regola eliminata" }); continue; }
    store.updateSend(s.id, { status: "sending" }); // prima dell'invio: dopo un crash non si rimanda
    try {
      await mailer.send(s.toAddr, renderEmail(rule, b!, cfg.calWebappUrl, cfg.tzDefault));
      store.updateSend(s.id, { status: "sent", attempts: s.attempts + 1, reason: "" });
    } catch (e) {
      const f = afterFailure(s, now, !!(e as any)?.temporary);
      store.updateSend(s.id, { status: f.status, attempts: f.attempts, reason: short(e) });
      log(`invio ${s.id} non riuscito: ${short(e)}`);
    }
  }
  store.setMeta("last_ok", now.toISOString());
}

export async function checkAlarm({ store, mailer, cfg, now: clock, log }: Deps): Promise<void> {
  const now = clock().getTime();
  const last = store.getMeta("last_ok") ?? store.getMeta("started_at");
  if (!last || now - new Date(last).getTime() <= 10 * MIN) return;
  const prev = store.getMeta("alarm_last");
  if (prev && now - new Date(prev).getTime() < 6 * 60 * MIN) return;
  const text = `D4 Avvisi non completa un giro da ${last}.\nUltimo errore: ${store.getMeta("last_error") ?? "sconosciuto"}\n` +
    "Finché non si risolve, i promemoria non partono. Controlla il servizio su Coolify.";
  try {
    await mailer.send(cfg.alarmEmail, { subject: "D4 Avvisi: non riesco a lavorare", text, html: emailHtml(text) });
    store.setMeta("alarm_last", new Date(now).toISOString());
  } catch (e) {
    log(`allarme non inviato: ${short(e)}`);
  }
}

export function recoverInterrupted(store: Store): void {
  for (const s of store.sendsWithStatus("sending")) store.updateSend(s.id, { status: "failed", reason: "interrotto" });
}
