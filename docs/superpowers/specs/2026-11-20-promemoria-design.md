# D4 Promemoria: design

Data: 2026-11-20 · Ramo: `d4/promemoria` · Cartella codice: `d4-services/promemoria/`

## Perché

Dario sostituisce TidyCal con Cal D4 (`cal.dimensione4.it`). TidyCal mandava **promemoria via email** all'ospite; il fork di Cal ha rimosso i Workflows, quindi oggi non parte nessun promemoria. Dario vuole anche **conferma e promemoria su WhatsApp** dal suo WhatsApp Business, con testi e tempi decisi da lui da una pagina. Questa è l'ultima cosa che manca per mettere Cal sul sito al posto di TidyCal. Requisito chiave detto da Dario: **"è importante che funzioni"**, poi la velocità.

## Approvazione e fasi (2026-11-24)

Approvato da Dario il 2026-11-24, con indirizzo **`avvisi.cal.dimensione4.it`** (record DNS `A avvisi.cal → 217.160.128.23` su Netsons, lo crea Dario).

- **Fase 1 (subito):** servizio completo con il solo canale **email** (regole, pagina, storico, allarme, test). Basta per sostituire TidyCal e mettere Cal sul sito.
- **Fase 2 (quando Meta si sblocca):** canale **WhatsApp** (template, approvazione, webhook stati, numero non WhatsApp, consenso nel modulo di Cal). Il codice della fase 1 prevede già il canale come campo della regola, così la fase 2 aggiunge senza rifare.

## Obiettivi

1. Per ogni prenotazione accettata su Cal, mandare all'ospite i messaggi previsti dalle **regole**:
   - default proposto: WhatsApp di conferma subito; email + WhatsApp 24 h prima; WhatsApp 15 min prima.
2. Regole configurabili da una **pagina web protetta**: canale (email / WhatsApp), momento (subito dopo la prenotazione, oppure N minuti/ore prima dell'inizio), testo, tipi di evento a cui si applica, attiva/spenta.
3. Dati presi in automatico dalla prenotazione: nome, cognome, email, numero, data/ora (fuso dell'ospite), link Meet, link per annullare/spostare.
4. Annullamenti e spostamenti rispettati: niente promemoria per una call annullata; una call spostata riceve i promemoria del nuovo orario.
5. "Numero vero": WhatsApp non permette una verifica preventiva. Lo si scopre dall'esito del primo messaggio (stato `failed`, es. codice 131026 = non raggiungibile su WhatsApp). In quel caso il numero è marcato **non WhatsApp**, gli altri messaggi WhatsApp per quella prenotazione vengono saltati e la pagina lo mostra.
6. Pagina con lo **storico invii** (inviato / consegnato / letto / fallito / saltato e perché).

## Non obiettivi

- Più clienti/aziende (multi-tenant): il progetto tech provider di Dario è separato.
- Chat bidirezionale, risposte automatiche, AI.
- SMS, Telegram.
- Modificare il cuore di Cal (nessuna patch al core, nessuna tabella nuova nel DB di Cal).
- La call da 15 minuti (Dario: "non la fa mai nessuno").

## Anti-obiettivi (fallimento anche se "funziona")

- Un promemoria per una call annullata, o mandato due volte.
- Un promemoria in ritardo (es. "tra 24 ore" mandato 2 ore prima). Se il momento è passato, si **salta**, non si recupera.
- Errori silenziosi: se un invio fallisce, deve vedersi nella pagina.
- WhatsApp a chi non ha dato il consenso.
- Segreti nel repo o stampati nei log.

## Vincoli

- Gira su **plancia** come servizio Coolify (regole skill `deploy-vps`: healthcheck, log controllati dopo il deploy). Immagine costruita su GitHub Actions (niente build locali), pubblicata su GHCR.
- Cal: Postgres 16 nel container `calcom_db-fwz6fszstkcyhjouwwpuog0e`, db `calcom`. Lettura con un **utente Postgres in sola lettura** (SELECT su `"Booking"`, `"Attendee"`, `"EventType"`). Crearlo è una modifica alla produzione: serve il via di Dario.
- Email: stesso SMTP di Cal (Amazon SES eu-north-1, porta 587, mittente `cal@dimensione4.it`, nome "Dimensione 4"). Le credenziali si copiano nelle env del nuovo servizio, non nel repo.
- WhatsApp: Cloud API di Meta, account aziendale verificato "Dimensione 4". Oggi **ha solo il numero di prova**: va collegato un numero vero (passo di Dario, guidato). Fuori dalla finestra di 24 h si possono mandare **solo template approvati** da Meta (categoria "utility").
- Il fork esegue la build Cal a ogni push su `d4/main` che non tocca solo `.md`: aggiungere `d4-services/**` a `paths-ignore` del workflow Cal, e un workflow separato per l'immagine promemoria.
- Stile codice D4: italiano nei testi, niente em-dash, tono "tu".

## Approcci considerati

- **A. Servizio che legge le prenotazioni dal DB di Cal (scelto da Dario).** Ogni minuto interroga il DB; prima di ogni invio ricontrolla lo stato. Nessun evento perso, annullamenti visti sempre. Contro: dipende dallo schema del DB di Cal (da ricontrollare a ogni aggiornamento di Cal).
- B. Servizio alimentato dai webhook di Cal. Se il servizio è giù l'evento si perde: servirebbe comunque un recupero dal DB.
- C. n8n (già su plancia). Testi e orari dentro n8n, cancellare un'attesa è scomodo, errori poco visibili.
- Scartato: rimettere i Workflows dentro Cal (grossa patch al core).

## Il design

### Componenti (un solo container)

- **Node 24**, TypeScript eseguito direttamente (type stripping di Node), dipendenze minime: `pg` (lettura DB Cal), `nodemailer` (SMTP). DB proprio con `node:sqlite` su un volume (`/data/promemoria.db`). HTTP con `node:http`, pagine HTML generate dal server (niente framework frontend).
- **Ciclo** ogni 60 s:
  1. **Sincronizza**: legge da Cal le prenotazioni con `startTime` nelle prossime 8 settimane o create/aggiornate dall'ultimo giro (`status`, `uid`, `startTime`, `endTime`, `eventTypeId`, `responses`, `location`, `fromReschedule`, primo `Attendee`: `name`, `email`, `timeZone`, `phoneNumber`).
  2. **Pianifica**: per ogni prenotazione `accepted` e ogni regola attiva applicabile crea (se non esiste) un invio `(booking_uid, rule_id)` con l'ora prevista. Vincolo UNIQUE su questa coppia, quindi niente doppi.
  3. **Invia** gli invii scaduti. Subito prima di ogni invio rilegge la prenotazione da Cal: se non è più `accepted` o l'orario è cambiato, segna `saltato`. Se l'ora prevista è passata da più di 10 minuti (tolleranza), `saltato (in ritardo)`. Lo stato `invio in corso` viene scritto **prima** della chiamata esterna: dopo un crash a metà non si rimanda (meglio un messaggio perso, visibile, che uno doppio).
- **Spostamenti**: Cal crea una nuova prenotazione (`fromReschedule` = uid vecchio) e mette la vecchia `cancelled` + `rescheduled`. La nuova riceve le sue regole; la conferma "subito" per una prenotazione spostata usa il testo "spostata" se la regola lo prevede (campo testo alternativo opzionale).
- **Regole "subito"**: valgono solo per prenotazioni create dopo l'attivazione della regola (niente ondata di conferme per prenotazioni vecchie al primo avvio).

### Canali

- **Email**: HTML con lo stesso stile delle email Cal D4 (fascia scura `#05070A`, logo `https://cal.dimensione4.it/emails/logo.png`, filetto ciano, scheda chiara), testo semplice incluso. Oggetto e corpo modificabili dalla pagina, con segnaposti `{nome}`, `{cognome}`, `{data}`, `{ora}`, `{titolo}`, `{link_call}`, `{link_gestisci}`.
- **WhatsApp**: messaggi template. Dalla pagina Dario scrive il testo con gli stessi segnaposti; il servizio lo converte in un template Meta (`{{1}}`, `{{2}}`...) e lo **invia a Meta per l'approvazione** via Graph API, mostrando lo stato (in attesa / approvato / rifiutato con motivo). Una regola WhatsApp parte solo con template approvato; finché non lo è, la pagina lo dice. Lingua `it`, categoria `UTILITY`.
- **Esiti WhatsApp**: endpoint pubblico `/meta/webhook` per gli stati dei messaggi (verifica `hub.verify_token` + firma `X-Hub-Signature-256` con l'app secret). Aggiorna lo storico; un `failed` con codice da numero non raggiungibile marca il numero come **non WhatsApp**.
- **Numero**: dal campo `attendeePhoneNumber` di `responses` (o `Attendee.phoneNumber`), formato E.164 (`+39...`); a Meta si passano solo le cifre.

### Consenso

Nel modulo di Cal (dal pannello admin, nessuna modifica di codice):
- etichetta del campo telefono → "Numero WhatsApp";
- nuova casella booleana `consensoWhatsapp`: "Voglio ricevere conferma e promemoria su WhatsApp".

Il servizio manda WhatsApp **solo** se c'è il numero **e** la casella è spuntata. L'email parte sempre (è il servizio richiesto).

### Pagina di gestione

- Dominio `avvisi.cal.dimensione4.it` (Coolify/Traefik, HTTPS), accesso con password (env `ADMIN_PASSWORD`, cookie di sessione firmato). Mobile first, stile D4 (scuro, ciano).
- Sezioni: **Regole** (lista, crea/modifica/attiva), **Testi WhatsApp** (stato approvazione), **Storico** (ultimi invii, filtro per prenotazione), **Prova** (manda un messaggio di prova a un numero/email dati, per controllare il testo).

### Configurazione (env su Coolify, nessuna nel repo)

`CAL_DATABASE_URL` (utente in sola lettura), `CAL_WEBAPP_URL`, `SMTP_HOST/PORT/USER/PASSWORD`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `WA_PHONE_NUMBER_ID`, `WA_WABA_ID`, `WA_TOKEN` (token permanente di un utente di sistema), `WA_APP_SECRET`, `WA_VERIFY_TOKEN`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `TZ_DEFAULT=Europe/Rome`.

### Rete

Il container deve raggiungere `calcom_db-fwz6...`: si collega alla rete Docker del servizio Cal su Coolify (rete esterna nel compose). Il DB di Cal non viene esposto all'esterno.

### Verifica prima della produzione

- Test automatici (`node --test`) sulla logica di pianificazione: regole subito/prima, salto se in ritardo, annullamento, spostamento, nessun doppio invio, consenso mancante.
- Prova completa sulla **copia di prova** su plancia (`d4reh-db` + `d4reh-app` + Mailpit): prenotazione → conferma, annullamento → niente promemoria, spostamento → promemoria del nuovo orario. WhatsApp col numero di prova di Meta verso il numero di Dario (lista ammessi).
- Poi produzione col via di Dario.

### Decisioni prese dopo la revisione (scelte mie, da confermare da Dario leggendo)

- **Webhook Meta isolato**: si usa l'URL di override **per account WhatsApp** (`override_callback_uri` su `subscribed_apps` del WABA), non l'URL generale dell'app. Così il progetto tech provider di Dario e questo servizio non si pestano. La copia di prova usa il numero di prova con un suo override.
- **Allarme attivo**: se per 10 minuti il ciclo non riesce (DB di Cal irraggiungibile, SMTP o token Meta rifiutati), il servizio manda **un'email a Dario** (al massimo una ogni 6 ore per lo stesso problema). L'healthcheck controlla che l'ultimo ciclo riuscito sia di meno di 3 minuti fa.
- **Testo WhatsApp modificato**: finché Meta non approva la nuova versione, si continua a mandare **l'ultima versione approvata**; la pagina mostra entrambe. Le versioni si salvano in una tabella propria.
- **Regola spenta o modificata**: gli invii non ancora partiti di quella regola vengono **annullati e ricalcolati**. Gli invii già partiti restano nello storico.
- **Ritentativi**: un invio rifiutato in modo chiaro (errore temporaneo di Meta o del server email) si ritenta una volta, solo dentro la tolleranza di 10 minuti. Dopo un crash a metà invio, nessun ritentativo.
- **Numero non WhatsApp**: vale per quel **numero**, anche nelle prenotazioni future, con un pulsante "riprova" nella pagina.

## Cosa resta al costruttore

Struttura dei file, schema SQLite preciso, aspetto delle pagine dentro lo stile D4, testi di default dei messaggi, intervallo di sincronizzazione (60 s proposto).

## Passi di Dario (lato Meta, guidati al momento)

1. Scegliere e collegare il numero vero all'account "Dimensione 4" (se il numero è già usato nell'app WhatsApp Business, valutare la coesistenza).
2. Creare l'utente di sistema e il token permanente per il servizio.
3. Impostare l'URL del webhook (`https://avvisi.cal.dimensione4.it/meta/webhook`) e il verify token nell'app Meta.
