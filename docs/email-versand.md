# E-Mail-Versand und Postfach

E-Mail für `jnsw.de` läuft vollständig über Cloudflare; Mailgun ist abgelöst.

- **Versand** (Bestätigungs-E-Mails, `app/mail.ts`): Cloudflare Email Service (Email Sending).
  Absender ist `service@jnsw.de` (überschreibbar mit dem Secret `MAIL_FROM`).
- **Empfang** (Postfach): Cloudflare Email Routing. Ein Catch-all leitet jede Adresse
  `…@jnsw.de` an eine bestätigte Zieladresse weiter. Cloudflare speichert keine Mails;
  das eigentliche Postfach ist die Zieladresse.

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

## Einrichtung: `scripts/cloudflare-mail.mjs`

Das Skript stellt die Zone um und ist wiederholbar. Ohne `--anwenden` zeigt es nur an.

```bash
export CLOUDFLARE_API_TOKEN=…        # Rechte siehe unten
NODE_USE_ENV_PROXY=1 node scripts/cloudflare-mail.mjs --weiterleiten-an <zieladresse>
NODE_USE_ENV_PROXY=1 node scripts/cloudflare-mail.mjs --weiterleiten-an <zieladresse> --anwenden
```

(`NODE_USE_ENV_PROXY=1` nur hinter einem HTTP-Proxy, z. B. in einer Cloud-Session.)

Ablauf:

1. Sicherung aller DNS-Einträge als JSON (Pfad steht in der Ausgabe, `--sicherung <datei>`).
2. Mailgun-Einträge entfernen: MX der Domain, alter SPF, alles mit „mailgun“ im Inhalt
   (z. B. `email.jnsw.de`). Alte DKIM-Schlüssel bleiben stehen und werden nur gemeldet.
3. Email Routing einschalten (`POST /zones/{zone}/email/routing/dns`): MX
   `route*.mx.cloudflare.net`, SPF `include:_spf.mx.cloudflare.net`, DKIM.
4. Zieladresse anlegen; Cloudflare schickt dorthin einen Bestätigungslink. Catch-all
   `*@jnsw.de → Zieladresse`. Erst nach dem Klick auf den Link kommen Mails an.
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
  muss in der Zieladresse ankommen.
