// Richtet E-Mail für eine Cloudflare-Zone ein und löst Mailgun ab (docs/email-versand.md):
//
//   1. sichert alle DNS-Einträge der Zone als JSON,
//   2. entfernt Mailgun-Einträge (MX, SPF, CNAME/TXT mit „mailgun“),
//   3. schaltet Email Routing ein (MX/SPF/DKIM von Cloudflare),
//   4. legt die Zieladresse an; der Catch-all gibt alles an den Worker des Mail-Eingangs
//      (--an-worker, der die Kopie an die Zieladresse weiterleitet) oder leitet direkt weiter,
//   5. schaltet Email Sending für die Domain ein (cf-bounce, DKIM),
//   6. ergänzt fehlende Einträge und einen DMARC-Eintrag (p=none), falls keiner da ist.
//
// Ohne --anwenden zeigt das Skript nur, was es tun würde. Wiederholbar: Vorhandenes bleibt.
//
//   CLOUDFLARE_API_TOKEN=… NODE_USE_ENV_PROXY=1 node scripts/cloudflare-mail.mjs \
//     --domain jnsw.de --weiterleiten-an ich@example.org --an-worker jnsw-mail-eingang [--anwenden]
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const API = "https://api.cloudflare.com/client/v4";

export function fqdn(name, domain) {
  const n = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!n || n === "@" || n === domain) return domain;
  return n.endsWith(`.${domain}`) ? n : `${n}.${domain}`;
}

export function txtValue(content) {
  return String(content ?? "")
    .trim()
    .replace(/^"(.*)"$/s, "$1")
    .replace(/"\s*"/g, "")
    .trim();
}

function sameContent(type, a, b) {
  if (type === "TXT") return txtValue(a) === txtValue(b);
  return (
    String(a ?? "")
      .toLowerCase()
      .replace(/\.$/, "") ===
    String(b ?? "")
      .toLowerCase()
      .replace(/\.$/, "")
  );
}

const isSpf = (record) => record.type === "TXT" && /^v=spf1\b/i.test(txtValue(record.content));
const isCloudflareMx = (record) => /\.mx\.cloudflare\.net\.?$/i.test(record.content ?? "");

/**
 * Welche vorhandenen Einträge weichen müssen, damit Cloudflare übernehmen kann.
 * Liefert { loeschen: [{record, grund}], warnungen: [text] }.
 */
export function mailgunAbloesen(records, domain) {
  const loeschen = [];
  const warnungen = [];
  for (const record of records) {
    const name = fqdn(record.name, domain);
    const content = String(record.content ?? "");
    if (record.type === "MX" && name === domain && !isCloudflareMx(record)) {
      loeschen.push({ record, grund: "MX der Domain zeigt nicht auf Cloudflare Email Routing" });
    } else if (isSpf(record) && name === domain) {
      const fremd = txtValue(content)
        .split(/\s+/)
        .slice(1)
        .filter((teil) => !/^[~?+-]?all$/i.test(teil))
        .filter(
          (teil) =>
            !/^include:(mailgun\.org|eu\.mailgun\.org|_spf\.mx\.cloudflare\.net)$/i.test(teil),
        );
      if (/include:_spf\.mx\.cloudflare\.net/i.test(content) && fremd.length === 0) continue;
      if (fremd.length)
        warnungen.push(
          `SPF ${name} enthält weitere Absender (${fremd.join(" ")}); bitte nach dem Lauf in den Cloudflare-SPF übernehmen.`,
        );
      loeschen.push({ record, grund: "alter SPF-Eintrag (Cloudflare legt einen eigenen an)" });
    } else if (/mailgun/i.test(content)) {
      loeschen.push({ record, grund: "verweist auf Mailgun" });
    } else if (record.type === "TXT" && /\._domainkey\./.test(name) && !/^cf/.test(name)) {
      warnungen.push(
        `DKIM-Schlüssel ${name} bleibt stehen (vermutlich Mailgun; schadet nicht, kann von Hand weg).`,
      );
    }
  }
  return { loeschen, warnungen };
}

/** Erwartete Einträge (aus der Cloudflare-API), die in der Zone noch fehlen. */
export function fehlendeEintraege(erwartet, vorhanden, domain) {
  return erwartet.filter(
    (soll) =>
      !vorhanden.some(
        (ist) =>
          ist.type === soll.type &&
          fqdn(ist.name, domain) === fqdn(soll.name, domain) &&
          sameContent(soll.type, ist.content, soll.content),
      ),
  );
}

/**
 * Soll-Regel des Catch-all: mit Worker die Aktion „worker“ (der Worker leitet die Kopie selbst
 * weiter), sonst „forward“ an die Zieladresse; ohne beides null (bleibt unverändert).
 */
export function catchAllRegel(opts) {
  if (opts.worker)
    return {
      name: `Alles an Worker ${opts.worker}`,
      enabled: true,
      matchers: [{ type: "all" }],
      actions: [{ type: "worker", value: [opts.worker] }],
    };
  if (opts.ziel)
    return {
      name: `Alles an ${opts.ziel}`,
      enabled: true,
      matchers: [{ type: "all" }],
      actions: [{ type: "forward", value: [opts.ziel] }],
    };
  return null;
}

/** Hat der vorhandene Catch-all schon genau die Aktion der Soll-Regel? */
export function catchAllPasst(ist, soll) {
  if (!ist?.enabled || !soll) return false;
  const [aktion] = soll.actions;
  return (
    ist.actions?.length === 1 &&
    ist.actions[0].type === aktion.type &&
    JSON.stringify(ist.actions[0].value ?? []) === JSON.stringify(aktion.value)
  );
}

export function argumente(argv) {
  const opts = { anwenden: false, domain: "jnsw.de", ziel: process.env.MAIL_WEITERLEITUNG ?? "" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--anwenden") opts.anwenden = true;
    else if (arg === "--domain") opts.domain = argv[++i];
    else if (arg === "--weiterleiten-an") opts.ziel = argv[++i];
    else if (arg === "--an-worker") opts.worker = argv[++i];
    else if (arg === "--sicherung") opts.sicherung = argv[++i];
    else throw new Error(`Unbekanntes Argument: ${arg}`);
  }
  opts.domain = String(opts.domain).toLowerCase();
  return opts;
}

function client(token) {
  return async function cf(method, pfad, body) {
    const response = await fetch(`${API}${pfad}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const daten = await response.json().catch(() => null);
    if (!response.ok || !daten?.success) {
      const fehler = (daten?.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ");
      const err = new Error(`${method} ${pfad} → ${response.status} ${fehler}`);
      err.status = response.status;
      throw err;
    }
    return daten.result;
  };
}

function eintragText(r) {
  const prio = r.priority !== undefined && r.type === "MX" ? ` ${r.priority}` : "";
  return `${r.type} ${r.name}${prio} ${String(r.content).slice(0, 90)}`;
}

async function main() {
  const opts = argumente(process.argv.slice(2));
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN fehlt.");
  const cf = client(token);
  const modus = opts.anwenden ? "" : "[Probe] ";
  const tun = async (text, aktion) => {
    console.log(`${modus}${text}`);
    if (opts.anwenden) return aktion();
  };

  await cf("GET", "/user/tokens/verify");
  const [zone] = await cf("GET", `/zones?name=${encodeURIComponent(opts.domain)}`);
  if (!zone) throw new Error(`Zone ${opts.domain} ist mit diesem Token nicht sichtbar.`);
  const zoneId = zone.id;
  const accountId = zone.account.id;
  console.log(`Zone ${zone.name} (${zoneId}), Account ${zone.account.name ?? accountId}`);

  const ladeDns = async () => {
    const alle = [];
    for (let seite = 1; ; seite++) {
      const teil = await cf("GET", `/zones/${zoneId}/dns_records?per_page=100&page=${seite}`);
      alle.push(...teil);
      if (teil.length < 100) return alle;
    }
  };
  const dns = await ladeDns();
  const sicherung =
    opts.sicherung ??
    path.join(
      os.tmpdir(),
      `dns-${opts.domain}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
  await writeFile(sicherung, JSON.stringify(dns, null, 2));
  console.log(`DNS-Sicherung (${dns.length} Einträge): ${sicherung}`);

  // 1. Mailgun ablösen
  const { loeschen, warnungen } = mailgunAbloesen(dns, opts.domain);
  for (const { record, grund } of loeschen)
    await tun(`Lösche ${eintragText(record)} – ${grund}`, () =>
      cf("DELETE", `/zones/${zoneId}/dns_records/${record.id}`),
    );

  // 2. Email Routing einschalten
  const routing = await cf("GET", `/zones/${zoneId}/email/routing`).catch(() => null);
  if (routing?.enabled) console.log(`Email Routing ist an (Status ${routing.status}).`);
  else
    await tun("Schalte Email Routing ein (MX/SPF/DKIM von Cloudflare)", () =>
      cf("POST", `/zones/${zoneId}/email/routing/dns`, { name: opts.domain }),
    );

  // 3. Zieladresse und Catch-all
  if (opts.ziel) {
    const adressen = await cf("GET", `/accounts/${accountId}/email/routing/addresses?per_page=50`);
    const adresse = adressen.find((a) => a.email.toLowerCase() === opts.ziel.toLowerCase());
    if (!adresse)
      await tun(
        `Lege Zieladresse ${opts.ziel} an (Cloudflare schickt einen Bestätigungslink)`,
        () => cf("POST", `/accounts/${accountId}/email/routing/addresses`, { email: opts.ziel }),
      );
    else if (!adresse.verified)
      console.log(
        `Zieladresse ${opts.ziel} ist noch nicht bestätigt – Link in der Cloudflare-Mail klicken.`,
      );
    else console.log(`Zieladresse ${opts.ziel} ist bestätigt.`);
  } else {
    console.log("Keine Zieladresse (--weiterleiten-an): keine Zieladresse angelegt.");
  }
  const soll = catchAllRegel(opts);
  if (soll) {
    const catchAll = await cf("GET", `/zones/${zoneId}/email/routing/rules/catch_all`).catch(
      () => null,
    );
    const ziel = opts.worker ? `Worker ${opts.worker}` : opts.ziel;
    if (catchAllPasst(catchAll, soll)) console.log(`Catch-all geht schon an ${ziel}.`);
    else
      await tun(`Catch-all: alle Adressen @${opts.domain} → ${ziel}`, () =>
        cf("PUT", `/zones/${zoneId}/email/routing/rules/catch_all`, soll),
      );
  } else {
    console.log("Weder --an-worker noch --weiterleiten-an: Catch-all bleibt unverändert.");
  }

  // 4. Email Sending einschalten
  const subdomains = await cf("GET", `/zones/${zoneId}/email/sending/subdomains`).catch((e) => {
    console.log(
      `Email Sending nicht abrufbar (${e.message}) – Workers Paid und Token-Recht prüfen.`,
    );
    return null;
  });
  let sending = subdomains?.find((s) => s.name === opts.domain);
  if (subdomains && !sending?.enabled)
    sending =
      (await tun(`Schalte Email Sending für ${opts.domain} ein`, () =>
        cf("POST", `/zones/${zoneId}/email/sending/subdomains`, { name: opts.domain }),
      )) ?? sending;
  if (sending?.enabled)
    console.log(
      `Email Sending an: DKIM-Selektor ${sending.dkim_selector ?? "?"}, Return-Path ${sending.return_path_domain ?? "?"}`,
    );

  // 5. Fehlende Einträge ergänzen
  if (!opts.anwenden) {
    console.log(
      "[Probe] Fehlende Einträge prüft erst der Lauf mit --anwenden (nach dem Einschalten).",
    );
    for (const w of warnungen) console.log(`Hinweis: ${w}`);
    return;
  }
  const erwartet = [
    ...(await cf("GET", `/zones/${zoneId}/email/routing/dns`).then(
      (r) => (Array.isArray(r) ? r : (r?.record ?? [])),
      () => [],
    )),
    ...(sending?.tag
      ? await cf("GET", `/zones/${zoneId}/email/sending/subdomains/${sending.tag}/dns`).catch(
          () => [],
        )
      : []),
  ];
  const nachher = await ladeDns();
  for (const soll of fehlendeEintraege(erwartet, nachher, opts.domain)) {
    await tun(`Ergänze ${eintragText(soll)}`, () =>
      cf("POST", `/zones/${zoneId}/dns_records`, {
        type: soll.type,
        name: fqdn(soll.name, opts.domain),
        content: soll.content,
        ttl: 1,
        ...(soll.type === "MX" ? { priority: soll.priority } : {}),
      }),
    );
  }
  if (
    !nachher.some((r) => r.type === "TXT" && fqdn(r.name, opts.domain) === `_dmarc.${opts.domain}`)
  )
    await tun(`Ergänze DMARC _dmarc.${opts.domain} (p=none)`, () =>
      cf("POST", `/zones/${zoneId}/dns_records`, {
        type: "TXT",
        name: `_dmarc.${opts.domain}`,
        content: "v=DMARC1; p=none",
        ttl: 1,
      }),
    );
  for (const w of warnungen) console.log(`Hinweis: ${w}`);
  console.log("Fertig.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
