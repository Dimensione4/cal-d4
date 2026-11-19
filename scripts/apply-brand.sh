#!/usr/bin/env bash
# D4 · Applica il brand sopra apps/web/public mantenendo i nomi file di upstream.
# Idempotente: si può rilanciare dopo ogni rebase su upstream.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/brand/assets"
PUB="$ROOT/apps/web/public"
APP_NAME="${APP_NAME:-Dimensione 4}"
THEME_COLOR="${THEME_COLOR:-#00AAAA}"
DESCRIPTION="${DESCRIPTION:-Prenota una call con Dimensione 4}"

[ -d "$SRC" ] || { echo "Manca $SRC" >&2; exit 1; }

# Loghi (constants.ts: LOGO, LOGO_DARK, LOGO_ICON + varianti)
for f in calcom-logo-white-word.svg cal-logo-word-dark.svg cal-logo-word-black.svg cal-logo-word.svg; do
  cp "$SRC/d4-wordmark.svg" "$PUB/$f"
done
for f in cal-com-icon-white.svg cal-com-icon.svg; do
  cp "$SRC/d4-symbol.svg" "$PUB/$f"
done

# Favicon e icone PWA
for f in favicon-16x16.png favicon-32x32.png favicon.ico apple-touch-icon.png mstile-150x150.png \
         android-chrome-192x192.png android-chrome-256x256.png android-chrome-384x384.png android-chrome-512x512.png; do
  cp "$SRC/$f" "$PUB/$f"
done

# Logo nelle email transazionali
cp "$SRC/email-logo.png" "$PUB/emails/logo.png"
# Icone email in ciano (nomi nuovi: Gmail tiene in cache le immagini per URL)
cp "$SRC/email-check@2x.png" "$PUB/emails/d4-checkCircle@2x.png"
cp "$SRC/email-calendar@2x.png" "$PUB/emails/d4-calendarCircle@2x.png"
cp "$SRC/email-team@2x.png" "$PUB/emails/d4-teamCircle@2x.png"

# Tema D4 (vetro, token del sito): lo importa apps/web/styles/globals.css (patch 07)
cp "$ROOT/brand/css/d4-theme.css" "$ROOT/apps/web/styles/d4-theme.css"

# Manifest PWA
node -e '
const fs = require("fs");
const [file, name, theme, desc] = process.argv.slice(1);
const m = JSON.parse(fs.readFileSync(file, "utf8"));
m.name = m.short_name = name; m.theme_color = theme; m.description = desc;
fs.writeFileSync(file, JSON.stringify(m, null, 4) + "\n");
' "$PUB/site.webmanifest" "$APP_NAME" "$THEME_COLOR" "$DESCRIPTION"

echo "Brand D4 applicato in $PUB"
