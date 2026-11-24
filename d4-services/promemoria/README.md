# D4 Avvisi

Promemoria email (fase 1) per le prenotazioni di Cal D4. Design: `docs/superpowers/specs/2026-11-20-promemoria-design.md`.

- Test: `npm test` (Node 22.18+; i test non usano `pg`/`nodemailer`).
- Immagine: `ghcr.io/dimensione4/cal-d4-avvisi:<AAAAMMGG>-<sha7>` (workflow `D4 Build Avvisi`).
- Dati: SQLite in `/data/avvisi.db` (volume).
- Pagina: `https://avvisi.cal.dimensione4.it` (password), `/health` senza login.

## Variabili d'ambiente (solo su Coolify)

| Nome | Cosa |
|---|---|
| `CAL_DATABASE_URL` | Postgres di Cal, utente in sola lettura `avvisi_ro` |
| `CAL_WEBAPP_URL` | `https://cal.dimensione4.it` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | stesso SMTP di Cal |
| `EMAIL_FROM`, `EMAIL_FROM_NAME` | `cal@dimensione4.it`, `Dimensione 4` |
| `ALARM_EMAIL` | dove arriva l'allarme |
| `ADMIN_PASSWORD` | password della pagina |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `TZ_DEFAULT` | facoltativa, default `Europe/Rome` |

Rollback: fermare il servizio su Coolify (Cal non ne dipende).
