# D4 Avvisi (fase 1, email) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servizio "D4 Avvisi" su plancia che legge le prenotazioni di Cal D4 e manda promemoria email all'ospite secondo regole modificabili da una pagina protetta su `avvisi.cal.dimensione4.it`.

**Architecture:** Un container Node 24. Ogni 60 s: legge le prenotazioni dal Postgres di Cal (utente in sola lettura), pianifica gli invii in un SQLite proprio (UNIQUE `booking_uid, rule_id`), manda quelli scaduti dopo aver ricontrollato la prenotazione. Pagine HTML generate dal server con `node:http`. La logica di pianificazione è pura e senza dipendenze, testata con `node --test`.

**Tech Stack:** Node 24 (type stripping, `node:sqlite`, `node:http`, `node:test`), `pg@8.13.1`, `nodemailer@6.9.16`. Docker `node:24-alpine`, GHCR, Coolify.

**Spec:** `docs/superpowers/specs/2026-11-20-promemoria-design.md` (fase 1 = solo email; WhatsApp in un piano successivo).

## Global Constraints

- Cartella: `d4-services/promemoria/` (fuori dai workspace Yarn di Cal). Nessuna modifica al core di Cal, nessuna tabella nel DB di Cal.
- Niente `yarn install` né build di Cal in locale. I test dell'app girano in locale con `node --test` (Node 22.20 locale ha type stripping e `node:sqlite`); i moduli testati in locale non importano `pg`/`nodemailer`.
- Import TypeScript con estensione `.ts` esplicita; solo sintassi "erasable" (niente `enum`, niente `namespace`, niente parameter properties).
- Testi in italiano, tono "tu", niente em-dash.
- Segreti solo in env su Coolify; mai nel repo, mai nei log, mai in chat.
- Tolleranza invio: **10 minuti**. Ciclo: **60 s**. Healthcheck ok se l'ultimo ciclo riuscito ha meno di **3 minuti**. Allarme email se nessun ciclo riuscito da **10 minuti**, al massimo **1 ogni 6 ore**.
- Finestra lettura da Cal: `startTime` tra ora − 1 giorno e ora + 56 giorni.
- Fuso di default `Europe/Rome`; data/ora formattate `it-IT` nel fuso dell'ospite (`Attendee.timeZone`), orario 24h.
- Segnaposti testo: `{nome}`, `{cognome}`, `{data}`, `{ora}`, `{titolo}`, `{link_call}`, `{link_gestisci}`.
- Stile email = email Cal D4: fascia `#05070A` con `https://cal.dimensione4.it/emails/logo.png` 208x52, filetto 3px gradiente `#12A5A3`→`#25E4E4`, scheda bianca raggio 16px bordo `#D6E2E8` su sfondo `#EEF3F6`, link `#086B6C`.
- Immagine: `ghcr.io/dimensione4/cal-d4-avvisi:<AAAAMMGG>-<sha7>`.

## Review Focus

1. Prenotazione creata meno di 24 h prima della call → il promemoria "24 h prima" è registrato `skipped` ("troppo tardi"), mai mandato in ritardo. (Test in Task 2.)
2. Prenotazione annullata dopo la pianificazione → l'invio pendente diventa `skipped` ("annullata") al momento dell'invio. (Test in Task 2.)
3. Call spostata: Cal crea un nuovo `uid` con `fromReschedule`; la vecchia è `cancelled`. Il nuovo uid riceve i promemoria del nuovo orario, con `body_rescheduled` se presente. (Test in Task 2 e Task 3.)
4. Primo avvio o regola "subito" appena creata → nessuna ondata di email per prenotazioni create prima della regola. (Test in Task 2.)
5. Nome ospite in forme diverse (`responses.name` oggetto `{firstName,lastName}`, stringa, assente → `Attendee.name`) e caratteri HTML nel nome/note → resi correttamente ed escapati. (Test in Task 3.)

---

### Task 1: Scheletro, config e database locale

**Files:**
- Create: `d4-services/promemoria/package.json`, `src/config.ts`, `src/store.ts`, `test/store.test.ts`, `.gitignore`

**Interfaces:**
- Produces:
  - `type Rule = { id: number; name: string; channel: "email" | "whatsapp"; trigger: "after_booking" | "before_start"; offsetMin: number; eventTypeIds: number[]; subject: string; body: string; bodyRescheduled: string; active: boolean; createdAt: string; updatedAt: string }` (`eventTypeIds` vuoto = tutti)
  - `type SendStatus = "pending" | "sending" | "sent" | "skipped" | "failed"`
  - `type Send = { id: number; bookingUid: string; ruleId: number; dueAt: string; bookingStart: string; status: SendStatus; reason: string; attempts: number; toAddr: string; createdAt: string; updatedAt: string }`
  - `openStore(path: string): Store` con metodi: `listRules(): Rule[]`, `getRule(id): Rule | undefined`, `saveRule(r: Omit<Rule,"id"|"createdAt"|"updatedAt"> & {id?: number}): Rule`, `deletePendingForRule(ruleId): number`, `listSends(limit: number, bookingUid?: string): Send[]`, `sendsByKey(): Map<string, Send>` (chiave `uid|ruleId`), `insertSend(s: Omit<Send,"id"|"createdAt"|"updatedAt">): void` (ignora i duplicati), `updateSend(id, patch: Partial<Send>): void`, `dueSends(nowIso: string): Send[]` (status pending e dueAt <= now), `getMeta(k): string | undefined`, `setMeta(k, v): void`, `seedDefaults(): void`
  - `loadConfig(env = process.env): Config` con `calDatabaseUrl, calWebappUrl, smtpHost, smtpPort, smtpUser, smtpPassword, emailFrom, emailFromName, alarmEmail, adminPassword, sessionSecret, dataDir, port (default 3000), tzDefault ("Europe/Rome")`; lancia errore che elenca le variabili mancanti (senza valori).

- [ ] **Step 1: Write the failing test** `test/store.test.ts`:
  - `saveRule` poi `getRule` restituisce gli stessi campi, `eventTypeIds` come array.
  - `insertSend` due volte con stesso `(bookingUid, ruleId)` → `listSends(10).length === 1`.
  - `deletePendingForRule` cancella solo i `pending` di quella regola (un `sent` resta).
  - `dueSends("2026-11-25T10:00:00.000Z")` include `dueAt` 09:59 pending, esclude 10:01 ed esclude status `sent`.
  - `seedDefaults()` su DB vuoto crea 1 regola: `name "Email 24 ore prima"`, `channel "email"`, `trigger "before_start"`, `offsetMin 1440`, `active true`; chiamata due volte non duplica.
  - `loadConfig({})` lancia un errore il cui messaggio contiene `CAL_DATABASE_URL`.
- [ ] **Step 2:** `cd d4-services/promemoria && node --test` → FAIL (moduli mancanti).
- [ ] **Step 3:** Implementa `src/store.ts` con `node:sqlite` (`DatabaseSync`), tabelle `rules`, `sends` (`UNIQUE(booking_uid, rule_id)`), `meta`; `INSERT OR IGNORE` per i send; date ISO UTC in testo. Testo default della regola seed: oggetto `Promemoria: {titolo} domani alle {ora}`, corpo di 3 righe in tono "tu" con `{nome}`, `{data}`, `{ora}`, `{link_call}`, `{link_gestisci}`. `package.json`: `"type": "module"`, dipendenze esatte `pg@8.13.1`, `nodemailer@6.9.16`, script `"test": "node --test"`, `"start": "node src/main.ts"`. `.gitignore`: `node_modules`, `data/`.
- [ ] **Step 4:** `node --test` → PASS.
- [ ] **Step 5:** Commit `feat(avvisi): scheletro, config e database locale`.

### Task 2: Logica di pianificazione (pura)

**Files:**
- Create: `src/plan.ts`, `test/plan.test.ts`

**Interfaces:**
- Consumes: `Rule`, `Send` (Task 1).
- Produces:
  - `type CalBooking = { uid: string; status: "accepted" | "cancelled" | "rejected" | "pending" | "awaiting_host"; startTime: string; endTime: string; createdAt: string; eventTypeId: number | null; title: string; fromReschedule: string | null; responses: unknown; location: string | null; metadata: unknown; attendee: { name: string; email: string; timeZone: string; phoneNumber: string | null } | null }`
  - `planSends(bookings: CalBooking[], rules: Rule[], existing: Map<string, Send>, now: Date): { inserts: Omit<Send,"id"|"createdAt"|"updatedAt">[]; reschedules: { id: number; dueAt: string; bookingStart: string }[] }`
  - `decideSend(send: Send, booking: CalBooking | undefined, now: Date, graceMin = 10): { action: "send" } | { action: "skip"; reason: string }`
  - `afterFailure(send: Send, now: Date, temporary: boolean, graceMin = 10): { status: "pending" | "failed"; attempts: number }`

Regole di `planSends` (fase 1 considera solo `channel === "email"` e regole attive):
- booking non `accepted` o senza `attendee.email` → nessun insert.
- `eventTypeIds` non vuoto e non contiene `eventTypeId` → nessun insert.
- `after_booking`: `dueAt = createdAt`; se `createdAt < rule.createdAt` → nessun insert (niente ondate).
- `before_start`: `dueAt = startTime − offsetMin`; se `dueAt < now − 10 min` → insert con `status "skipped"`, `reason "troppo tardi"`; altrimenti `pending`.
- Chiave già presente in `existing` con `status "pending"` e `bookingStart !== startTime` → voce in `reschedules` col nuovo `dueAt`.
- `toAddr = attendee.email`.

- [ ] **Step 1: Write the failing test** `test/plan.test.ts`, `now = 2026-11-25T10:00:00Z`, regola R24 (before_start, 1440, creata 2026-11-01):
  - call il 2026-11-27T10:00Z → 1 insert `pending`, `dueAt "2026-11-26T10:00:00.000Z"`.
  - call il 2026-11-25T20:00Z → 1 insert `skipped` con `reason "troppo tardi"`.
  - booking `cancelled` → 0 insert.
  - regola `after_booking` creata 2026-11-25T09:00Z, booking creato 2026-11-24 → 0 insert; booking creato 2026-11-25T09:30Z → 1 insert `dueAt = createdAt`.
  - `eventTypeIds [3]` con booking `eventTypeId 1` → 0 insert.
  - regola inattiva o `channel "whatsapp"` → 0 insert.
  - existing pending con `bookingStart` diverso → 1 voce in `reschedules`.
  - `decideSend`: booking assente → skip "annullata"; `cancelled` → skip "annullata"; `startTime` diverso da `send.bookingStart` → skip "orario cambiato"; `now > dueAt + 10 min` → skip "in ritardo"; altrimenti `send`.
  - `afterFailure`: temporaneo, `attempts 0`, dentro la tolleranza → `pending`, attempts 1; secondo fallimento → `failed`; non temporaneo → `failed`.
- [ ] **Step 2:** `node --test test/plan.test.ts` → FAIL.
- [ ] **Step 3:** Implementa `src/plan.ts`.
- [ ] **Step 4:** `node --test` → PASS.
- [ ] **Step 5:** Commit `feat(avvisi): pianificazione degli invii`.

### Task 3: Testi ed email HTML

**Files:**
- Create: `src/render.ts`, `test/render.test.ts`

**Interfaces:**
- Consumes: `CalBooking` (Task 2), `Rule` (Task 1).
- Produces:
  - `bookingVars(b: CalBooking, webappUrl: string, tzDefault: string): Record<"nome"|"cognome"|"data"|"ora"|"titolo"|"link_call"|"link_gestisci", string>`
  - `fill(text: string, vars: Record<string,string>): string` (segnaposti sconosciuti restano come sono)
  - `renderEmail(rule: Rule, b: CalBooking, webappUrl: string, tzDefault: string): { subject: string; html: string; text: string }` (usa `bodyRescheduled` se `b.fromReschedule` e non vuoto)

Valori: `nome/cognome` da `responses.name.firstName/lastName`, oppure da `responses.name` stringa o `attendee.name` (prima parola = nome, resto = cognome). `link_call` = `metadata.videoCallUrl`, altrimenti `location` se inizia con `http`, altrimenti stringa vuota. `link_gestisci` = `${webappUrl}/booking/${uid}`. `data` es. `venerdì 27 novembre 2026`, `ora` es. `11:00` (fuso `attendee.timeZone`, fallback `tzDefault`).

- [ ] **Step 1: Write the failing test** `test/render.test.ts`:
  - `responses.name = {firstName:"Sara", lastName:"Rossi"}` → `nome "Sara"`, `cognome "Rossi"`.
  - `responses.name = "Mario De Luca"` → `nome "Mario"`, `cognome "De Luca"`; senza responses → da `attendee.name`.
  - start `2026-11-27T10:00:00Z`, tz `Europe/Rome` → `data "venerdì 27 novembre 2026"`, `ora "11:00"`.
  - `metadata.videoCallUrl` presente → `link_call` uguale; assente con `location "integrations:google:meet"` → `""`.
  - `fill("Ciao {nome} {xyz}", {nome:"A"}) === "Ciao A {xyz}"`.
  - nome `<b>x</b>` → l'HTML contiene `&lt;b&gt;x&lt;/b&gt;` e non `<b>x</b>`; il testo semplice contiene `<b>x</b>`.
  - `fromReschedule` valorizzato e `bodyRescheduled "Spostata {ora}"` → `text` contiene `Spostata 11:00`.
  - HTML contiene `#05070A`, `https://cal.dimensione4.it/emails/logo.png`, `#25E4E4`.
- [ ] **Step 2:** `node --test test/render.test.ts` → FAIL.
- [ ] **Step 3:** Implementa `src/render.ts` (`Intl.DateTimeFormat("it-IT", {timeZone, hourCycle:"h23"})`; HTML a tabelle con stili inline; a capo del corpo → `<br>`; link resi cliccabili).
- [ ] **Step 4:** `node --test` → PASS.
- [ ] **Step 5:** Commit `feat(avvisi): testi ed email col brand D4`.

### Task 4: Lettura da Cal, invio email, ciclo, allarme

**Files:**
- Create: `src/cal.ts`, `src/mail.ts`, `src/loop.ts`, `test/loop.test.ts`

**Interfaces:**
- Consumes: Task 1-3.
- Produces:
  - `cal.ts`: `createCal(url: string): { listWindow(now: Date): Promise<CalBooking[]>; get(uid: string): Promise<CalBooking | undefined>; close(): Promise<void> }`. SQL su `"Booking"` (`uid, status, "startTime", "endTime", "createdAt", "eventTypeId", title, "fromReschedule", responses, location, metadata`) + primo `"Attendee"` per `id` (`name, email, "timeZone", "phoneNumber"`); finestra dai Global Constraints.
  - `mail.ts`: `createMailer(cfg: Config): { send(to: string, m: {subject; html; text}): Promise<void> }`; errore con `temporary: boolean` (true per codici SMTP 4xx e errori di rete).
  - `loop.ts`: `runCycle(deps: { store; cal; mailer; cfg; now: () => Date; log: (msg: string) => void }): Promise<void>` e `checkAlarm(deps): Promise<void>`. `runCycle`: `listWindow` → `planSends` → insert/reschedule → per ogni `dueSends`: `cal.get(uid)` → `decideSend` → se `send`: `updateSend(status "sending")` **prima** di `mailer.send`, poi `sent` oppure `afterFailure`; a fine giro `setMeta("last_ok", now)`. Un errore che blocca il giro (Cal irraggiungibile) si propaga e `last_ok` non si aggiorna. All'avvio i send rimasti `sending` diventano `failed` con `reason "interrotto"` (nessun ritentativo). `checkAlarm`: se `now − last_ok > 10 min` e `now − alarm_last > 6 h` → email a `alarmEmail` con oggetto `D4 Avvisi: non riesco a lavorare` e l'ultimo errore, poi `setMeta("alarm_last")`.

- [ ] **Step 1: Write the failing test** `test/loop.test.ts` con store reale su `:memory:`, cal e mailer finti:
  - booking futuro + regola R24 con due ore all'invio → dopo `runCycle` con `now` = dueAt + 1 min, il mailer ha ricevuto 1 email a `attendee.email` e il send è `sent`.
  - secondo `runCycle` uguale → nessuna seconda email.
  - booking cancellato tra pianificazione e invio → 0 email, send `skipped` "annullata".
  - mailer che lancia `{temporary:true}` → send torna `pending` con attempts 1; al giro dopo riesce → `sent`.
  - cal che lancia in `listWindow` → `runCycle` rifiuta e `getMeta("last_ok")` resta invariato.
  - `checkAlarm` con `last_ok` di 11 minuti fa → 1 email all'allarme; di nuovo subito → nessuna seconda email.
  - send in `sending` all'avvio → `failed` "interrotto".
- [ ] **Step 2:** `node --test test/loop.test.ts` → FAIL.
- [ ] **Step 3:** Implementa `src/loop.ts` (le dipendenze iniettate permettono test senza `pg`/`nodemailer`), poi `src/cal.ts` e `src/mail.ts` (import di `pg` e `nodemailer` solo lì).
- [ ] **Step 4:** `node --test` → PASS.
- [ ] **Step 5:** Commit `feat(avvisi): ciclo di invio, lettura Cal e allarme`.

### Task 5: Pagina di gestione e avvio

**Files:**
- Create: `src/web.ts`, `src/main.ts`, `test/web.test.ts`

**Interfaces:**
- Consumes: `Store`, `Config`, `renderEmail`, `mailer`.
- Produces: `createServer(deps: { store; cfg; mailer; now: () => Date }): http.Server`. Rotte:
  - `GET /health` → 200 `ok` se `last_ok` < 3 min, altrimenti 503 (senza login).
  - `GET /login`, `POST /login` (password confrontata con `crypto.timingSafeEqual`, cookie `avvisi_s` HMAC-SHA256 con `SESSION_SECRET`, `HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`). Senza cookie valido ogni altra rotta → 302 `/login`.
  - `GET /` → elenco regole (nome, canale, quando, attiva) + ultimi 20 invii.
  - `GET /regole/nuova`, `GET /regole/:id`, `POST /regole/:id` (salva; poi `deletePendingForRule`), `POST /regole/:id/attiva` (inverte `active`; poi `deletePendingForRule`).
  - `GET /storico?uid=` → ultimi 200 invii, filtro per prenotazione.
  - `POST /prova` (regola + email) → manda l'email della regola con una prenotazione finta ("Mario Rossi", domani 11:00) all'indirizzo dato.
  - `main.ts`: `loadConfig`, `openStore(dataDir/avvisi.db)`, `seedDefaults`, ripristino `sending`→`failed`, server su `port`, `setInterval` 60 s con `runCycle` + `checkAlarm` (errori loggati come una riga senza segreti), `SIGTERM` chiude server e pool.
- UI: mobile first, sfondo `#05070A`, testo `#EBF1F4`, primario `#12A5A3`, accento `#25E4E4`, font di sistema; ogni valore escapato. Nel form regola: quando (Subito dopo la prenotazione / Prima della call + minuti), tipi di evento (vuoto = tutti), oggetto, testo, testo per call spostata, attiva. Il canale WhatsApp non compare in fase 1.

- [ ] **Step 1: Write the failing test** `test/web.test.ts` (server su porta 0, store `:memory:`, mailer finto):
  - `GET /` senza cookie → 302 verso `/login`.
  - `POST /login` password sbagliata → 401; giusta → 302 con `Set-Cookie` contenente `HttpOnly` e `SameSite=Strict`.
  - con cookie: `POST /regole/nuova` crea una regola; un send pending di quella regola viene cancellato dopo `POST /regole/:id`.
  - `POST /regole/:id/attiva` inverte `active`.
  - `GET /health` con `last_ok` di 1 min fa → 200; di 5 min fa → 503.
  - regola con nome `<script>` → la pagina contiene `&lt;script&gt;`.
  - `POST /prova` → il mailer finto riceve 1 email all'indirizzo dato.
- [ ] **Step 2:** `node --test test/web.test.ts` → FAIL.
- [ ] **Step 3:** Implementa `src/web.ts` e `src/main.ts`.
- [ ] **Step 4:** `node --test` → PASS tutti.
- [ ] **Step 5:** Commit `feat(avvisi): pagina di gestione e avvio del servizio`.

### Task 6: Immagine Docker e build su GitHub

**Files:**
- Create: `d4-services/promemoria/Dockerfile`, `d4-services/promemoria/.dockerignore`, `.github/workflows/d4-build-avvisi.yml`, `d4-services/promemoria/README.md` (env, deploy, prova)
- Modify: `.github/workflows/d4-build-image.yml:8` → `paths-ignore: ["**.md", "d4-services/**", ".github/workflows/d4-build-avvisi.yml"]`

- [ ] **Step 1:** Dockerfile: `node:24-alpine`, `npm install --omit=dev` con le versioni esatte, copia `src/`, utente `node`, `VOLUME /data`, `EXPOSE 3000`, `HEALTHCHECK` con `wget -qO- http://127.0.0.1:3000/health`, `CMD ["node","src/main.ts"]`.
- [ ] **Step 2:** Workflow: su push a `d4/promemoria` e `d4/main` con `paths: ["d4-services/promemoria/**", ".github/workflows/d4-build-avvisi.yml"]` e `workflow_dispatch`; job `node --test` con Node 24 (dopo `npm install`), poi build e push del tag `<AAAAMMGG UTC>-<sha7>` + `latest` su GHCR con `GITHUB_TOKEN`.
- [ ] **Step 3:** Avvisa Dario, poi push del ramo; `gh run list -R Dimensione4/cal-d4 --workflow d4-build-avvisi.yml` → run verde; tag letto dal log. Controlla che "D4 Build Image" di Cal **non** sia partito.
- [ ] **Step 4:** Commit `ci(avvisi): immagine Docker e build`.

### Task 7: Prova completa sulla copia di prova

Nessun file nel repo (script nello scratchpad).

- [ ] **Step 1:** Su plancia ricrea la copia (`~/cal-d4-rehearsal/`: `d4reh-db` dal dump più recente con le pulizie note, `d4reh-mail` Mailpit, `d4reh-app`), più un container `d4reh-avvisi` con l'immagine del Task 6 sulla rete `d4reh`, `CAL_DATABASE_URL` verso `d4reh-db` con un utente in sola lettura creato **solo sulla copia**, SMTP verso `d4reh-mail:1025`, `CAL_WEBAPP_URL=http://localhost:3001`, porta `127.0.0.1:3012`. Tunnel `-L 3001 -L 8026 -L 3012`.
- [ ] **Step 2:** Dalla pagina: regola "subito" e regola "prima della call" con minuti tali da scattare entro 3 minuti dalla prenotazione. Prenota con `book.mjs`. Atteso in Mailpit: email "subito" entro 2 minuti, poi quella "prima" all'orario giusto, con il brand D4, data e ora corrette (screenshot desktop e mobile).
- [ ] **Step 3:** Prenota di nuovo e annulla prima dello scatto → nessuna email "prima"; storico `skipped` "annullata". Sposta una prenotazione → email con il testo "spostata".
- [ ] **Step 4:** Ferma `d4reh-db` per 11 minuti → arriva l'email di allarme in Mailpit; `/health` → 503; riavvia → 200.
- [ ] **Step 5:** Manda a Dario gli screenshot. Spegni la copia (`down.sh` + `d4reh-avvisi`) e chiudi il tunnel.

### Task 8: Produzione (solo col via di Dario)

- [ ] **Step 1:** Dario ha creato `A avvisi.cal → 217.160.128.23` su Netsons; verifica con `Resolve-DnsName avvisi.cal.dimensione4.it`.
- [ ] **Step 2:** Col via di Dario: sul Postgres di Cal crea `avvisi_ro` (password generata sul server, mai stampata) con `CONNECT` su `calcom`, `USAGE` su `public`, `SELECT` solo su `"Booking"`, `"Attendee"`, `"EventType"`. Verifica che un `INSERT` venga rifiutato.
- [ ] **Step 3:** Servizio Coolify su plancia via API: compose con l'immagine del Task 6, volume `/data`, dominio `https://avvisi.cal.dimensione4.it`, rete esterna del servizio Cal (`fwz6fszstkcyhjouwwpuog0e`). Env: SMTP ed `EMAIL_FROM*` copiati dal container Cal lato server; `CAL_DATABASE_URL` con `avvisi_ro`; `SESSION_SECRET` generato sul server; `ALARM_EMAIL=dariomarcobellini@dimensione4.it`; `ADMIN_PASSWORD` **lo inserisce Dario** in Coolify (comando di generazione dato secondo la skill `env-segreti`).
- [ ] **Step 4:** Avvio: container healthy, log senza errori, `/health` 200, login ok dal telefono di Dario, `POST /prova` verso l'email di Dario arrivata.
- [ ] **Step 5:** Aggiorna `D4.md` e la memoria del progetto (dove gira, porta, dominio, rollback = fermare il servizio).
