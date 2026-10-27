# E-Mail-Versand und Mail-Eingang

E-Mail für `jnsw.de` läuft vollständig über Cloudflare; Mailgun ist abgelöst.

- **Versand** (Bestätigungs-E-Mails, `app/mail.ts`): Cloudflare Email Service (Email Sending).
  Absender ist `service@jnsw.de` (überschreibbar mit dem Secret `MAIL_FROM`).
- **Empfang** (Mail-Eingang): Cloudflare Email Routing. Ein eigenes Postfach gibt es nicht.
  Ein Catch-all gibt jede Adresse `…@jnsw.de` an den Worker `jnsw-mail-eingang`
  (`worker/mail-eingang.ts`). Der leitet eine Kopie an die eigene Adresse weiter und liefert
  die Mail als Kundenanfrage an jw-dev.

## Versand im Worker

`app/mail.ts` nimmt bevorzugt das Workers-Binding `EMAIL` (`send_email` in
`wrangler.production.jsonc`, nur Absender `service@jnsw.de` erlaubt). Fehlt das Binding,
etwa weil der Worker nicht direkt auf Cloudflare läuft, nutzt es die REST-API
`POST /accounts/{account_id}/email/sending/send` mit den Secrets
`CLOUDFLARE_ACCOUNT_ID` und `CLOUDFLARE_EMAIL_API_TOKEN` (Token nur mit dem Recht für
Email Sending). Ist beides nicht da, schlägt der Versand fehl und die Registrierung meldet 503.

Der Text der Nachricht steht in `app/mail-message.ts`. Tracking gibt es beim Cloudflare
Email Service nicht.

Voraussetzungen: `jnsw.de` nutzt Cloudflare DNS, und der Account hat Workers Paid
(Versand an beliebige Empfänger; Email Routing allein geht auch im Free-Plan).

Bei der Registrierung wird ein zufälliger Bestätigungstoken erzeugt, ausschließlich als
SHA-256-Hash in D1 gespeichert und nach 24 Stunden ungültig. Passwortkonten können sich erst
nach der E-Mail-Bestätigung anmelden. Ein Anmeldeversuch mit korrektem Passwort und noch
unbestätigter Adresse sendet einen neuen Bestätigungslink.

## Mail-Eingang: `worker/mail-eingang.ts`

Eigener Worker (`wrangler.mail-eingang.jsonc`) mit `email()`- und `scheduled()`-Handler:

1. Liest die Mail mit `postal-mime`: Absender (Kopfzeile `From`), Empfänger (Umschlag),
   Betreff, Datum, Message-ID, Text (ohne Textteil aus dem HTML). Anhänge werden nicht
   gespeichert, nur Name und Größe. Fehlt die Message-ID, entsteht eine aus der Prüfsumme der Mail.
2. Ordnet das Projekt über die Empfängeradresse zu (`vars.ZUORDNUNG`, etwa
   `mymvz@jnsw.de → mymvz-wordpress`); alles andere ist `unzugeordnet`.
3. Legt die Mail in D1 ab (Datenbank `jnsw-mail-eingang`, Tabelle `mail_eingang`, Migration
   in `worker/mail-eingang-migrations/`), je Message-ID und Empfänger einmal, Status `offen`.
4. Leitet eine Kopie an `KOPIE_AN` weiter (muss in Email Routing als Zieladresse bestätigt
   sein), je Message-ID einmal, mit dem Kopf `X-Mail-Eingang-Projekt`. Scheitert das, wirft
   der Worker; der Absender-Server stellt erneut zu, und nichts wird doppelt angelegt.
5. Schickt die Mail an jw-dev: `POST https://orga.jnsw.de/api/mail-eingang` mit dem
   Access-Service-Token (`CF-Access-Client-Id`/`-Secret`) und `token-mail` des Dienstes
   (`X-JW-Dev-Token`). Angenommen heißt `gesendet`; antwortet jw-dev 400/413/415/422, heißt sie
   `abgewiesen` und wird nicht wiederholt. Sonst (Dienst aus, Tunnel weg) bleibt sie `offen`,
   und der Cron alle 15 Minuten schickt bis zu 50 offene erneut.

jw-dev legt daraus eine Kundenanfrage an (Kanal `E-Mail`, Quelle Absender, Titel Betreff,
Notiz gekürzter Text, Schlüssel aus der Message-ID; doppelte Zustellung legt nichts doppelt
an). Unzugeordnete Mails stehen dort oben auf der Seite „Anfragen“.

Datenschutz: Kundenmails stehen nur in D1 und in der Datenbank von jw-dev, nie im Repo, in
Issues oder Logs; der Worker protokolliert nur Zeilen-IDs und HTTP-Status. Der Text gesendeter
Mails wird in D1 nach 30 Tagen geleert, die übrigen Felder bleiben als Nachweis.

Secrets (`npx wrangler secret put <NAME> --config wrangler.mail-eingang.jsonc`):

| Secret                    | Inhalt                                                            |
| ------------------------- | ----------------------------------------------------------------- |
| `KOPIE_AN`                | eigene Adresse für die Kopie (bestätigte Zieladresse)             |
| `JW_DEV_TOKEN`            | Inhalt von `token-mail` des Dienstes (`jw-dev link --mail`: Pfad) |
| `CF_ACCESS_CLIENT_ID`     | Service Token der Access-Anwendung vor `orga.jnsw.de`             |
| `CF_ACCESS_CLIENT_SECRET` | dazu das Secret (eigenes Service Token, getrennt widerrufbar)     |

Einrichten:

```bash
npx wrangler d1 create jnsw-mail-eingang          # ID in wrangler.mail-eingang.jsonc eintragen
npx wrangler d1 migrations apply jnsw-mail-eingang --remote --config wrangler.mail-eingang.jsonc
npx wrangler deploy --config wrangler.mail-eingang.jsonc
# Secrets setzen (s. o.), dann das Skript unten mit --an-worker jnsw-mail-eingang
```

Offene oder abgewiesene Mails ansehen (zeigt keine Inhalte):

```bash
npx wrangler d1 execute jnsw-mail-eingang --remote --config wrangler.mail-eingang.jsonc \
  --command "SELECT id, projekt, status, versuche, letzter_fehler FROM mail_eingang WHERE status != 'gesendet'"
```

## Einrichtung: `scripts/cloudflare-mail.mjs`

Das Skript stellt die Zone um und ist wiederholbar. Ohne `--anwenden` zeigt es nur an.

```bash
export CLOUDFLARE_API_TOKEN=…        # Rechte siehe unten
NODE_USE_ENV_PROXY=1 node scripts/cloudflare-mail.mjs --weiterleiten-an <zieladresse> --an-worker jnsw-mail-eingang
NODE_USE_ENV_PROXY=1 node scripts/cloudflare-mail.mjs --weiterleiten-an <zieladresse> --an-worker jnsw-mail-eingang --anwenden
```

(`NODE_USE_ENV_PROXY=1` nur hinter einem HTTP-Proxy, z. B. in einer Cloud-Session.)

Ablauf:

1. Sicherung aller DNS-Einträge als JSON (Pfad steht in der Ausgabe, `--sicherung <datei>`).
2. Mailgun-Einträge entfernen: MX der Domain, alter SPF, alles mit „mailgun“ im Inhalt
   (z. B. `email.jnsw.de`). Alte DKIM-Schlüssel bleiben stehen und werden nur gemeldet.
3. Email Routing einschalten (`POST /zones/{zone}/email/routing/dns`): MX
   `route*.mx.cloudflare.net`, SPF `include:_spf.mx.cloudflare.net`, DKIM.
4. Zieladresse anlegen; Cloudflare schickt dorthin einen Bestätigungslink. Catch-all
   `*@jnsw.de → Worker jnsw-mail-eingang` (`--an-worker`; der Worker muss schon deployt sein),
   ohne `--an-worker` direkt `→ Zieladresse`. Erst nach dem Klick auf den Link kommen Kopien an.
5. Email Sending einschalten (`POST /zones/{zone}/email/sending/subdomains`,
   Name `jnsw.de`): Bounce-MX/SPF auf `cf-bounce.jnsw.de`, DKIM-Schlüssel.
6. Fehlende Einträge aus den Soll-Listen der API ergänzen; `_dmarc` mit `p=none` anlegen,
   falls keiner existiert.

API-Token (Cloudflare → My Profile → API Tokens → Custom Token):

| Bereich | Recht                                               |
| ------- | --------------------------------------------------- |
| Zone    | Zone: Read, DNS: Edit                               |
| Zone    | Email Routing Rules: Edit, Zone Settings: Edit      |
| Zone    | Email Sending: Edit (falls als Zone-Recht gelistet) |
| Account | Email Routing Addresses: Edit, Email Sending: Edit  |

Zone Resources: nur `jnsw.de`; Account Resources: der Account der Zone.

## Nach der Umstellung

- Worker mit dem `EMAIL`-Binding deployen (`deploy-production.yml`) oder für die REST-API
  `CLOUDFLARE_ACCOUNT_ID` und `CLOUDFLARE_EMAIL_API_TOKEN` setzen.
- Alte Secrets `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_API_BASE_URL` entfernen
  (`wrangler secret delete … --config wrangler.production.jsonc`), die Domain bei Mailgun löschen.
- Probe: Registrierung mit einer eigenen Adresse; Mail an eine beliebige Adresse `@jnsw.de`
  muss in der Zieladresse und in jw-dev (Seite „Anfragen“) ankommen.
