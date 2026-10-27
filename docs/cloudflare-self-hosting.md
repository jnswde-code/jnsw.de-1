# Eigenständiger Betrieb auf Cloudflare (unabhängig von OpenAI Sites)

## Ausgangslage

Die Produktion von jnsw.de läuft aktuell über die OpenAI-Sites-Hostingplattform:

- `www.jnsw.de` zeigt per CNAME auf `custom-domains.chatgpt.site`.
- `.openai/hosting.json` teilt der Sites-Plattform mit, welche D1- und
  R2-Ressourcen sie für den Worker bereitstellen soll.
- `wrangler.jsonc` im Repo-Root beschreibt laut ausdrücklicher Konvention nur
  die **lokale** D1-Simulation, nicht die Produktion.

Der Anwendungscode selbst hat keine harte Abhängigkeit von OpenAI: `db/index.ts`
und `worker/index.ts` nutzen ausschließlich Standard-Cloudflare-Workers-Bindings
(`env.DB`, `env.APPLICATION_DOCUMENTS`, `env.AI`). Wer diese Bindings bereitstellt,
ist dem Code egal. Diese Anleitung stellt sie stattdessen aus einem eigenen
Cloudflare-Account bereit.

`wrangler.production.jsonc` und `.github/workflows/deploy-production.yml` sind
bereits vorbereitet, aber mit Platzhaltern versehen. Diese Anleitung ersetzt sie
durch echte Werte.

## 1. Cloudflare-Ressourcen anlegen

Voraussetzung: `wrangler login` mit dem Ziel-Account ausgeführt (oder ein
`CLOUDFLARE_API_TOKEN` lokal gesetzt).

```bash
# D1-Datenbank für die Produktion anlegen
npx wrangler d1 create jnswde-production --config wrangler.production.jsonc

# R2-Bucket für Dokument-Uploads anlegen
npx wrangler r2 bucket create jnswde-application-documents
```

Der `d1 create`-Befehl gibt eine `database_id` aus. Diese in
`wrangler.production.jsonc` anstelle von `REPLACE_WITH_REAL_D1_DATABASE_ID`
eintragen.

## 2. Migrationen einmalig lokal testen, dann remote anwenden

```bash
npx wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc
```

Dieser Schritt läuft danach automatisch als Teil des Deploy-Workflows
(`.github/workflows/deploy-production.yml`).

## 3. Secrets setzen

Alle Werte, die aktuell vermutlich über die OpenAI-Sites-Plattform verwaltet
werden, müssen als Cloudflare-Worker-Secrets neu gesetzt werden:

```bash
npx wrangler secret put IMPORT_AI_SHARED_SECRET --config wrangler.production.jsonc
npx wrangler secret put IMPORT_AI_WORKER_URL --config wrangler.production.jsonc
```

E-Mail braucht keine Secrets mehr: Der Versand läuft über das Binding `EMAIL`
(Cloudflare Email Service), siehe `docs/email-versand.md`. Die alten
`MAILGUN_*`-Secrets können entfernt werden.

Falls die Bewerbungswerkstatt (PR #90 / #81) oder Support-KI (PR #90) live gehen
sollen, kommen je nach Umsetzungsstand weitere Secrets hinzu (z. B.
`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` für Support-KI).

## 4. GitHub Actions einrichten

Im Repo unter **Settings → Secrets and variables → Actions** anlegen:

- `CLOUDFLARE_API_TOKEN` – Token mit Workers-Deploy- und D1-Rechten für den
  Ziel-Account.
- `CLOUDFLARE_ACCOUNT_ID` – die Account-ID, unter der die Ressourcen aus
  Schritt 1 angelegt wurden.

Außerdem eine Actions-Umgebung namens `production` anlegen (Settings →
Environments), damit `deploy-production.yml` sie referenzieren kann; optional
mit Required Reviewers absichern, bevor ein Deploy tatsächlich läuft.

## 5. Manuell testen

Den Workflow einmal manuell auslösen (Actions → "Deploy production
(self-hosted Cloudflare)" → Run workflow) und prüfen, ob der Worker unter
seiner `*.workers.dev`-Subdomain erreichbar ist und Datenbankzugriffe
funktionieren.

## 6. Custom Domain umstellen (DNS-Schnitt)

Erst wenn Schritt 5 zuverlässig funktioniert:

1. In Cloudflare unter **Workers & Pages → jnswde → Settings → Domains &
   Routes** die Domains `jnsw.de` und `www.jnsw.de` als Custom Domain
   hinzufügen. Das erzeugt automatisch die passenden DNS-Einträge in der
   Cloudflare-Zone.
2. Den bestehenden CNAME `www.jnsw.de → custom-domains.chatgpt.site` entfernen
   bzw. durch den von Cloudflare erzeugten Eintrag ersetzen.
3. Die auskommentierten `routes`-Einträge in `wrangler.production.jsonc`
   aktivieren und erneut deployen.
4. Erst danach den `on:`-Trigger in `deploy-production.yml` von
   `workflow_dispatch` auf `push: { branches: [main] }` umstellen, um
   automatische Deploys aus dem CI heraus zu aktivieren.

**Wichtig:** Schritt 6 ist eine Produktions-DNS-Änderung mit direkter Wirkung
auf die live erreichbare Seite. Erst ausführen, wenn Schritt 1–5 vollständig
verifiziert sind, und im Zweifel außerhalb der Hauptnutzungszeit.

## Offene Punkte, die nicht rein technisch sind

- `.openai/hosting.json` kann im Repo bleiben (schadet nicht) oder entfernt
  werden, sobald die Sites-Plattform nicht mehr genutzt wird — das ist eine
  bewusste Entscheidung, kein technischer Zwang.
- „Sign in with ChatGPT" (in `AGENTS.md` als vorgesehener zweiter Login-Weg
  erwähnt) ist bisher nicht implementiert. Ohne OpenAI-Sites-Hosting sind die
  dafür nötigen Identitäts-Header ohnehin nicht vertrauenswürdig — diese
  Auth-Variante sollte bei einem Wechsel auf reines Cloudflare-Hosting nicht
  weiterverfolgt werden.
