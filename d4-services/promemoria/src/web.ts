import http from "node:http";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.ts";
import type { Rule, RuleInput, Send, Store } from "./store.ts";
import type { Mailer } from "./loop.ts";
import type { CalBooking } from "./plan.ts";
import { esc, renderEmail } from "./render.ts";

type WebDeps = { store: Store; cfg: Config; mailer: Mailer; now: () => Date };
const COOKIE = "avvisi_s";
const MAX_AGE = 2_592_000; // 30 giorni

const sign = (secret: string, v: string) => createHmac("sha256", secret).update(v).digest("hex");
const same = (a: string, b: string) => {
  const x = createHash("sha256").update(a).digest(), y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
};

function sessionOk(req: http.IncomingMessage, cfg: Config, now: Date) {
  const raw = (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return false;
  const [exp, mac] = raw.split(".");
  return !!exp && !!mac && same(mac, sign(cfg.sessionSecret, exp)) && Number(exp) > now.getTime();
}

async function readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of req) { body += chunk; if (body.length > 100_000) throw new Error("troppo grande"); }
  return new URLSearchParams(body);
}

const CSS = `*{box-sizing:border-box}body{margin:0;background:#05070A;color:#EBF1F4;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:20px 16px 48px}a{color:#25E4E4}h1{font-size:22px;margin:4px 0 20px}h2{font-size:17px;margin:28px 0 10px;color:#A8B7C2}
.card{background:#0C1217;border:1px solid rgba(235,241,244,.08);border-radius:12px;padding:14px 16px;margin:0 0 10px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}.muted{color:#A8B7C2;font-size:14px}
label{display:block;margin:12px 0 4px;color:#A8B7C2;font-size:14px}input,select,textarea{width:100%;background:#05070A;color:#EBF1F4;border:1px solid rgba(235,241,244,.16);border-radius:10px;padding:10px;font:inherit}
textarea{min-height:120px}button{background:linear-gradient(135deg,#12A5A3,#25E4E4);color:#031012;border:0;border-radius:999px;padding:10px 18px;font-weight:700;font:inherit;cursor:pointer}
button.ghost{background:transparent;color:#25E4E4;border:1px solid #12A5A3}.err{background:#3a1114;border-color:#7a2a30}.inline{display:flex;gap:8px}.inline>*{flex:1}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:8px 6px;border-bottom:1px solid rgba(235,241,244,.08);vertical-align:top}.wrap{overflow-x:auto}`;

const page = (title: string, body: string) => `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · D4 Avvisi</title><style>${CSS}</style></head>
<body><main><p class="muted"><a href="/">D4 Avvisi</a> · <a href="/storico">Storico</a></p>${body}</main></body></html>`;

const STATUS: Record<string, string> = { pending: "in attesa", sending: "in invio", sent: "inviato", skipped: "saltato", failed: "fallito" };
const when = (r: Rule) => {
  if (r.trigger === "after_booking") return "Subito dopo la prenotazione";
  const m = r.offsetMin;
  const t = m % 1440 === 0 ? `${m / 1440} ${m === 1440 ? "giorno" : "giorni"}` : m % 60 === 0 ? `${m / 60} ${m === 60 ? "ora" : "ore"}` : `${m} minuti`;
  return `${t} prima della call`;
};
const fmt = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("it-IT", { timeZone: tz, dateStyle: "short", timeStyle: "short", hourCycle: "h23" }).format(new Date(iso));

function sendsTable(sends: Send[], rules: Rule[], tz: string) {
  if (!sends.length) return `<p class="muted">Nessun invio ancora.</p>`;
  const name = new Map(rules.map((r) => [r.id, r.name]));
  return `<div class="wrap"><table><tr><th>Quando</th><th>Regola</th><th>A</th><th>Stato</th></tr>${sends.map((s) => `<tr>
<td>${esc(fmt(s.dueAt, tz))}</td><td>${esc(name.get(s.ruleId) ?? "?")}</td>
<td><a href="/storico?uid=${encodeURIComponent(s.bookingUid)}">${esc(s.toAddr)}</a></td>
<td>${esc(STATUS[s.status] ?? s.status)}${s.reason ? `<br><span class="muted">${esc(s.reason)}</span>` : ""}</td></tr>`).join("")}</table></div>`;
}

function ruleFormHtml(r: Partial<Rule>, action: string, error = "") {
  const m = r.offsetMin ?? 1440;
  const [q, u] = m % 1440 === 0 && m ? [m / 1440, "giorni"] : m % 60 === 0 && m ? [m / 60, "ore"] : [m, "minuti"];
  const opt = (v: string, cur: string, label: string) => `<option value="${v}"${v === cur ? " selected" : ""}>${label}</option>`;
  return `${error ? `<div class="card err">${esc(error)}</div>` : ""}<form method="post" action="${action}" class="card">
<label>Nome</label><input name="name" value="${esc(r.name ?? "")}" required>
<label>Quando</label><select name="trigger">${opt("before_start", r.trigger ?? "before_start", "Prima della call")}${opt("after_booking", r.trigger ?? "", "Subito dopo la prenotazione")}</select>
<label>Quanto prima (solo per "Prima della call")</label><div class="inline"><input name="quanto" type="number" min="0" value="${q}">
<select name="unita">${opt("minuti", u as string, "minuti")}${opt("ore", u as string, "ore")}${opt("giorni", u as string, "giorni")}</select></div>
<label>Tipi di evento (numeri separati da virgola, vuoto = tutti)</label><input name="eventi" value="${esc((r.eventTypeIds ?? []).join(","))}">
<label>Oggetto email</label><input name="subject" value="${esc(r.subject ?? "")}" required>
<label>Testo</label><textarea name="body" required>${esc(r.body ?? "")}</textarea>
<label>Testo se la call è stata spostata (facoltativo)</label><textarea name="bodyRescheduled">${esc(r.bodyRescheduled ?? "")}</textarea>
<p class="muted">Segnaposti: {nome} {cognome} {data} {ora} {titolo} {link_call} {link_gestisci}</p>
<label><input type="checkbox" name="active" style="width:auto"${r.active ?? true ? " checked" : ""}> Attiva</label>
<p><button>Salva</button></p></form>`;
}

function parseRule(f: URLSearchParams, id?: number): RuleInput | string {
  const name = (f.get("name") ?? "").trim(), body = (f.get("body") ?? "").trim(), subject = (f.get("subject") ?? "").trim();
  const trigger = f.get("trigger") === "after_booking" ? "after_booking" : "before_start";
  const quanto = Number(f.get("quanto") ?? 0);
  const mult = { minuti: 1, ore: 60, giorni: 1440 }[f.get("unita") ?? "minuti"] ?? 1;
  const ids = (f.get("eventi") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  const errors = [!name && "nome", !subject && "oggetto", !body && "testo",
    (!Number.isInteger(quanto) || quanto < 0) && "quanto prima", ids.some((n) => !Number.isInteger(n)) && "tipi di evento"].filter(Boolean);
  if (errors.length) return `Controlla i campi: ${errors.join(", ")}.`;
  return { id, name, channel: "email", trigger, offsetMin: trigger === "after_booking" ? 0 : quanto * mult, eventTypeIds: ids,
    subject, body, bodyRescheduled: (f.get("bodyRescheduled") ?? "").trim(), active: f.get("active") === "on" };
}

function fakeBooking(now: Date, email: string): CalBooking {
  const start = new Date(now.getTime() + 86_400_000);
  start.setUTCHours(10, 0, 0, 0);
  return { uid: "prova", status: "accepted", startTime: start.toISOString(), endTime: start.toISOString(), createdAt: now.toISOString(),
    eventTypeId: null, title: "Call Conoscitiva 30 min", fromReschedule: null, responses: { name: { firstName: "Mario", lastName: "Rossi" } },
    location: null, metadata: { videoCallUrl: "https://meet.google.com/prova" },
    attendee: { name: "Mario Rossi", email, timeZone: "Europe/Rome", phoneNumber: null } };
}

export function createServer({ store, cfg, mailer, now }: WebDeps): http.Server {
  const tz = cfg.tzDefault;
  return http.createServer(async (req, res) => {
    const send = (status: number, html: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", "x-frame-options": "DENY", "referrer-policy": "no-referrer", ...headers });
      res.end(html);
    };
    const go = (to: string, headers: Record<string, string> = {}) => { res.writeHead(302, { location: to, ...headers }); res.end(); };
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const p = url.pathname, post = req.method === "POST";

      if (p === "/health") {
        const last = store.getMeta("last_ok");
        const ok = !!last && now().getTime() - new Date(last).getTime() < 180_000;
        res.writeHead(ok ? 200 : 503, { "content-type": "text/plain" });
        return res.end(ok ? "ok" : "fermo");
      }
      if (p === "/login") {
        const formHtml = (err = "") => page("Accesso", `<h1>D4 Avvisi</h1>${err ? `<div class="card err">${err}</div>` : ""}
<form method="post" class="card"><label>Password</label><input type="password" name="password" autofocus required><p><button>Entra</button></p></form>`);
        if (!post) return send(200, formHtml());
        const f = await readForm(req);
        if (!same(f.get("password") ?? "", cfg.adminPassword)) {
          await new Promise((r) => setTimeout(r, 500)); // rallenta i tentativi
          return send(401, formHtml("Password sbagliata."));
        }
        const exp = String(now().getTime() + MAX_AGE * 1000);
        return go("/", { "set-cookie": `${COOKIE}=${exp}.${sign(cfg.sessionSecret, exp)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}` });
      }
      if (!sessionOk(req, cfg, now())) return go("/login");

      if (p === "/" && !post) {
        const rules = store.listRules();
        const list = rules.map((r) => `<div class="card"><div class="row"><div><strong>${esc(r.name)}</strong><br>
<span class="muted">Email · ${esc(when(r))} · ${r.active ? "attiva" : "spenta"}</span></div>
<div class="inline" style="flex:0 0 auto"><a href="/regole/${r.id}">Modifica</a>
<form method="post" action="/regole/${r.id}/attiva"><button class="ghost">${r.active ? "Spegni" : "Accendi"}</button></form></div></div>
<form method="post" action="/prova" class="inline" style="margin-top:10px"><input type="hidden" name="ruleId" value="${r.id}">
<input type="email" name="email" placeholder="Email per la prova" required><button class="ghost">Manda prova</button></form></div>`).join("");
        const msg = url.searchParams.get("ok") === "prova" ? `<div class="card">Email di prova inviata.</div>` : "";
        return send(200, page("Regole", `<h1>Regole</h1>${msg}${list}<p><a href="/regole/nuova">+ Nuova regola</a></p>
<h2>Ultimi invii</h2>${sendsTable(store.listSends(20), rules, tz)}`));
      }
      if (p === "/storico" && !post) {
        const uid = url.searchParams.get("uid") ?? undefined;
        return send(200, page("Storico", `<h1>Storico${uid ? ` · ${esc(uid)}` : ""}</h1>${sendsTable(store.listSends(200, uid), store.listRules(), tz)}`));
      }
      if (p === "/prova" && post) {
        const f = await readForm(req);
        const rule = store.getRule(Number(f.get("ruleId")));
        const email = (f.get("email") ?? "").trim();
        if (!rule || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(400, page("Prova", `<div class="card err">Regola o email non valida.</div>`));
        await mailer.send(email, renderEmail(rule, fakeBooking(now(), email), cfg.calWebappUrl, tz));
        return go("/?ok=prova");
      }
      const m = p.match(/^\/regole\/(nuova|\d+)(\/attiva)?$/);
      if (m) {
        const id = m[1] === "nuova" ? undefined : Number(m[1]);
        const existing = id ? store.getRule(id) : undefined;
        if (id && !existing) return send(404, page("Non trovata", `<p>Regola non trovata.</p>`));
        if (m[2]) {
          if (!post || !existing) return send(405, page("Errore", ""));
          store.saveRule({ ...existing, active: !existing.active });
          store.deletePendingForRule(existing.id);
          return go("/");
        }
        const action = `/regole/${m[1]}`;
        if (!post) return send(200, page("Regola", `<h1>${existing ? "Modifica regola" : "Nuova regola"}</h1>${ruleFormHtml(existing ?? {}, action)}`));
        const parsed = parseRule(await readForm(req), id);
        if (typeof parsed === "string") return send(400, page("Regola", `<h1>Regola</h1>${ruleFormHtml(existing ?? {}, action, parsed)}`));
        const saved = store.saveRule(parsed);
        store.deletePendingForRule(saved.id);
        return go("/");
      }
      return send(404, page("Non trovata", `<p>Pagina non trovata.</p>`));
    } catch (e) {
      console.error(`errore pagina: ${String((e as any)?.message ?? e).slice(0, 200)}`);
      if (!res.headersSent) send(500, page("Errore", `<p>Qualcosa è andato storto.</p>`));
    }
  });
}
