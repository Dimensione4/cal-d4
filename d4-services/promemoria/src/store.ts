import { DatabaseSync } from "node:sqlite";

export type Rule = {
  id: number; name: string; channel: "email" | "whatsapp"; trigger: "after_booking" | "before_start";
  offsetMin: number; eventTypeIds: number[]; subject: string; body: string; bodyRescheduled: string;
  active: boolean; createdAt: string; updatedAt: string;
};
export type SendStatus = "pending" | "sending" | "sent" | "skipped" | "failed";
export type Send = {
  id: number; bookingUid: string; ruleId: number; dueAt: string; bookingStart: string; status: SendStatus;
  reason: string; attempts: number; toAddr: string; createdAt: string; updatedAt: string;
};
export type RuleInput = Omit<Rule, "id" | "createdAt" | "updatedAt"> & { id?: number };
export type SendInput = Omit<Send, "id" | "createdAt" | "updatedAt">;
export type Store = ReturnType<typeof openStore>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, channel TEXT NOT NULL, trigger TEXT NOT NULL,
  offset_min INTEGER NOT NULL DEFAULT 0, event_type_ids TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', body_rescheduled TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sends (
  id INTEGER PRIMARY KEY, booking_uid TEXT NOT NULL, rule_id INTEGER NOT NULL, due_at TEXT NOT NULL,
  booking_start TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0, to_addr TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(booking_uid, rule_id));
CREATE INDEX IF NOT EXISTS sends_due ON sends(status, due_at);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`;

const now = () => new Date().toISOString();

// ponytail: mapping a mano colonna<->campo, poche tabelle, niente ORM
const toRule = (r: any): Rule => ({
  id: r.id, name: r.name, channel: r.channel, trigger: r.trigger, offsetMin: r.offset_min,
  eventTypeIds: JSON.parse(r.event_type_ids), subject: r.subject, body: r.body, bodyRescheduled: r.body_rescheduled,
  active: !!r.active, createdAt: r.created_at, updatedAt: r.updated_at,
});
const toSend = (r: any): Send => ({
  id: r.id, bookingUid: r.booking_uid, ruleId: r.rule_id, dueAt: r.due_at, bookingStart: r.booking_start,
  status: r.status, reason: r.reason, attempts: r.attempts, toAddr: r.to_addr, createdAt: r.created_at, updatedAt: r.updated_at,
});
const SEND_COLS: Record<string, string> = {
  dueAt: "due_at", bookingStart: "booking_start", status: "status", reason: "reason", attempts: "attempts", toAddr: "to_addr",
};

export const DEFAULT_RULE: RuleInput = {
  name: "Email 24 ore prima", channel: "email", trigger: "before_start", offsetMin: 1440, eventTypeIds: [],
  subject: "Promemoria: {titolo} domani alle {ora}",
  body: "Ciao {nome}, ti ricordo la nostra call di {data} alle {ora}.\nPer collegarti: {link_call}\nSe devi spostarla o annullarla: {link_gestisci}",
  bodyRescheduled: "", active: true,
};

export function openStore(path: string) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const getRule = (id: number) => {
    const r = db.prepare("SELECT * FROM rules WHERE id = ?").get(id);
    return r ? toRule(r) : undefined;
  };
  return {
    listRules: () => db.prepare("SELECT * FROM rules ORDER BY id").all().map(toRule),
    getRule,
    saveRule(r: RuleInput): Rule {
      const t = now();
      const v = [r.name, r.channel, r.trigger, r.offsetMin, JSON.stringify(r.eventTypeIds), r.subject, r.body, r.bodyRescheduled, r.active ? 1 : 0];
      if (r.id) {
        db.prepare(`UPDATE rules SET name=?, channel=?, trigger=?, offset_min=?, event_type_ids=?, subject=?, body=?,
          body_rescheduled=?, active=?, updated_at=? WHERE id=?`).run(...v, t, r.id);
        return getRule(r.id)!;
      }
      const res = db.prepare(`INSERT INTO rules (name, channel, trigger, offset_min, event_type_ids, subject, body,
        body_rescheduled, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(...v, t, t);
      return getRule(Number(res.lastInsertRowid))!;
    },
    deletePendingForRule: (ruleId: number) =>
      Number(db.prepare("DELETE FROM sends WHERE rule_id = ? AND status = 'pending'").run(ruleId).changes),
    listSends(limit: number, bookingUid?: string): Send[] {
      const rows = bookingUid
        ? db.prepare("SELECT * FROM sends WHERE booking_uid = ? ORDER BY due_at DESC LIMIT ?").all(bookingUid, limit)
        : db.prepare("SELECT * FROM sends ORDER BY due_at DESC LIMIT ?").all(limit);
      return rows.map(toSend);
    },
    sendsByKey: () => new Map(db.prepare("SELECT * FROM sends").all().map(toSend).map((s) => [`${s.bookingUid}|${s.ruleId}`, s])),
    insertSend(s: SendInput) {
      const t = now();
      db.prepare(`INSERT OR IGNORE INTO sends (booking_uid, rule_id, due_at, booking_start, status, reason, attempts,
        to_addr, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(s.bookingUid, s.ruleId, s.dueAt, s.bookingStart, s.status, s.reason, s.attempts, s.toAddr, t, t);
    },
    updateSend(id: number, patch: Partial<Send>) {
      const keys = Object.keys(patch).filter((k) => SEND_COLS[k]);
      if (!keys.length) return;
      db.prepare(`UPDATE sends SET ${keys.map((k) => `${SEND_COLS[k]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
        .run(...keys.map((k) => (patch as any)[k]), now(), id);
    },
    // true solo se l'invio era ancora in attesa: così un invio cancellato o già preso non parte
    claimSend: (id: number) =>
      Number(db.prepare("UPDATE sends SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'pending'").run(now(), id).changes) === 1,
    sendsWithStatus:(status: SendStatus) => db.prepare("SELECT * FROM sends WHERE status = ?").all(status).map(toSend),
    dueSends: (nowIso: string) =>
      db.prepare("SELECT * FROM sends WHERE status = 'pending' AND due_at <= ? ORDER BY due_at").all(nowIso).map(toSend),
    getMeta(k: string): string | undefined {
      const r: any = db.prepare("SELECT value FROM meta WHERE key = ?").get(k);
      return r?.value;
    },
    setMeta(k: string, v: string) {
      db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
    },
    seedDefaults() {
      if (db.prepare("SELECT COUNT(*) AS n FROM rules").get()!.n === 0) this.saveRule(DEFAULT_RULE);
    },
    close: () => db.close(),
  };
}
