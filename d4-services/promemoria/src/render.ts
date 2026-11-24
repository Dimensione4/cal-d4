import type { CalBooking } from "./plan.ts";
import type { Rule } from "./store.ts";

type Vars = Record<"nome" | "cognome" | "data" | "ora" | "titolo" | "link_call" | "link_gestisci", string>;

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function splitName(full: string): [string, string] {
  const parts = full.trim().split(/\s+/);
  return [parts[0] ?? "", parts.slice(1).join(" ")];
}

function names(b: CalBooking): [string, string] {
  const n = (b.responses as any)?.name;
  if (n && typeof n === "object" && n.firstName) return [String(n.firstName), String(n.lastName ?? "")];
  if (typeof n === "string" && n.trim()) return splitName(n);
  return splitName(b.attendee?.name ?? "");
}

function validTz(tz: string | undefined, fallback: string) {
  try { if (tz) { new Intl.DateTimeFormat("it-IT", { timeZone: tz }); return tz; } } catch {}
  return fallback;
}

export function bookingVars(b: CalBooking, webappUrl: string, tzDefault: string): Vars {
  const timeZone = validTz(b.attendee?.timeZone, tzDefault);
  const d = new Date(b.startTime);
  const [nome, cognome] = names(b);
  const video = (b.metadata as any)?.videoCallUrl;
  return {
    nome, cognome, titolo: b.title,
    data: new Intl.DateTimeFormat("it-IT", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d),
    ora: new Intl.DateTimeFormat("it-IT", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d),
    link_call: typeof video === "string" && video ? video : b.location?.startsWith("http") ? b.location : "",
    link_gestisci: `${webappUrl}/booking/${b.uid}`,
  };
}

export const fill = (text: string, vars: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

const linkify = (escaped: string) =>
  escaped.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#086B6C;font-weight:600">${u}</a>`);

export function emailHtml(bodyText: string): string {
  const body = linkify(esc(bodyText)).replace(/\n/g, "<br>");
  return `<!doctype html><html lang="it"><body style="margin:0;padding:0;background:#EEF3F6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF3F6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid #D6E2E8;border-radius:16px;overflow:hidden">
<tr><td style="background:#05070A;padding:20px 24px"><img src="https://cal.dimensione4.it/emails/logo.png" width="208" height="52" alt="Dimensione 4" style="display:block;border:0"></td></tr>
<tr><td style="height:3px;line-height:3px;font-size:0;background:#12A5A3;background-image:linear-gradient(90deg,#12A5A3,#25E4E4)">&nbsp;</td></tr>
<tr><td style="padding:28px 24px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;color:#0B1A22">${body}</td></tr>
</table>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#4B5B66;margin:16px 0 0">Dimensione 4</p>
</td></tr></table></body></html>`;
}

export function renderEmail(rule: Rule, b: CalBooking, webappUrl: string, tzDefault: string) {
  const vars = bookingVars(b, webappUrl, tzDefault);
  const text = fill(b.fromReschedule && rule.bodyRescheduled.trim() ? rule.bodyRescheduled : rule.body, vars);
  return { subject: fill(rule.subject, vars), text, html: emailHtml(text) };
}
