// Mail-Eingang (docs/email-versand.md): Cloudflare Email Routing gibt jede Mail an eine Adresse
// …@jnsw.de per Catch-all an diesen Worker. Ein eigenes Postfach gibt es nicht.
//
//   1. Mail lesen (postal-mime): Absender, Empfänger, Betreff, Datum, Message-ID, Text;
//      von Anhängen nur Name und Größe.
//   2. Projekt über die Empfängeradresse zuordnen (Variable ZUORDNUNG), sonst „unzugeordnet“.
//   3. In D1 ablegen (mail_eingang, Status offen), je Message-ID und Empfänger einmal.
//   4. Eine Kopie an KOPIE_AN weiterleiten (bestätigte Zieladresse in Email Routing), je
//      Message-ID einmal.
//   5. An jw-dev schicken (POST {JW_DEV_URL}/api/mail-eingang, Access-Service-Token und
//      token-mail); angenommen heißt gesendet. Ein Cron alle 15 Minuten schickt offene erneut,
//      damit nichts verloren geht, wenn der Dienst zu Hause aus ist.
//
// Kundenmails können personenbezogene Daten enthalten: Sie stehen nur in D1 und in jw-dev.
// Logs nennen nie Adresse, Betreff oder Text, nur die Zeilen-ID in D1 und HTTP-Status.
import PostalMime from "postal-mime";

export const UNZUGEORDNET = "unzugeordnet";
const TEXT_MAX = 50_000; // jw-dev kürzt weiter; D1 hält die Zeile klein
const ZEILE_MAX = 900;
const ANHAENGE_MAX = 50;
const STAPEL = 50; // offene Mails je Cron-Lauf
const TEXT_AUFBEWAHREN_TAGE = 30; // danach wird der Text gesendeter Mails in D1 geleert
const ABGEWIESEN = new Set([400, 413, 415, 422]); // jw-dev nimmt sie so nie an: nicht wiederholen

type D1Ergebnis = { meta: { changes: number } };
export interface D1Abfrage {
  bind(...werte: unknown[]): D1Abfrage;
  run(): Promise<D1Ergebnis>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface D1 {
  prepare(sql: string): D1Abfrage;
}

/** Was Email Routing übergibt (ForwardableEmailMessage). */
export interface EingehendeMail {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
}

interface Kontext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface Env {
  DB: D1;
  /** Bestätigte Zieladresse in Email Routing (Secret). */
  KOPIE_AN?: string;
  /** Empfängeradresse → jw-dev-Projekt, als Objekt oder JSON-Text. */
  ZUORDNUNG?: Record<string, string> | string;
  /** z. B. https://orga.jnsw.de */
  JW_DEV_URL: string;
  /** Inhalt von token-mail des Dienstes (Secret). */
  JW_DEV_TOKEN?: string;
  /** Service Token für Cloudflare Access vor orga.jnsw.de (Secrets). */
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
}

export type Anhang = { name: string; groesse: number };
export type Eingang = {
  message_id: string;
  von: string;
  an: string;
  betreff: string;
  datum: string;
  text: string;
  projekt: string;
  anhaenge: Anhang[];
};

type Zeile = {
  id: number;
  message_id: string;
  empfaenger: string;
  absender: string;
  betreff: string;
  datum: string;
  text: string;
  projekt: string;
  anhaenge: string;
};

type Mailbox = { name?: string; address?: string; group?: Mailbox[] };

function zeile(wert: string | undefined | null, grenze = ZEILE_MAX): string {
  return String(wert ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, grenze);
}

/** Projekt zur Empfängeradresse; ohne Eintrag (oder bei kaputter ZUORDNUNG) „unzugeordnet“. */
export function zuordnen(adresse: string, zuordnung: Env["ZUORDNUNG"]): string {
  let tabelle: Record<string, unknown> = {};
  if (typeof zuordnung === "string") {
    try {
      tabelle = JSON.parse(zuordnung || "{}") as Record<string, unknown>;
    } catch {
      console.error("ZUORDNUNG ist kein gültiges JSON; alles gilt als unzugeordnet.");
    }
  } else if (zuordnung) tabelle = zuordnung;
  const gesucht = adresse.trim().toLowerCase();
  for (const [schluessel, projekt] of Object.entries(tabelle)) {
    if (
      schluessel.trim().toLowerCase() === gesucht &&
      typeof projekt === "string" &&
      projekt.trim()
    )
      return projekt.trim();
  }
  return UNZUGEORDNET;
}

export function adresseText(adresse: Mailbox | undefined, ersatz: string): string {
  const erste = adresse?.group ? adresse.group[0] : adresse;
  if (!erste?.address) return zeile(ersatz, 320);
  const mitName = zeile(erste.name ? `${erste.name} <${erste.address}>` : erste.address);
  return mitName.length <= 320 ? mitName : zeile(erste.address, 320); // jw-dev nimmt höchstens 320 Zeichen
}

/** Grober Klartext aus HTML, falls die Mail keinen Textteil hat. */
export function htmlZuText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function groesse(inhalt: ArrayBuffer | Uint8Array | string): number {
  return typeof inhalt === "string" ? new TextEncoder().encode(inhalt).length : inhalt.byteLength;
}

async function pruefsumme(roh: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", roh);
  return [...new Uint8Array(hash)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Die Felder für D1 und jw-dev aus der gelesenen Mail; ohne Message-ID eine aus der Prüfsumme. */
export async function eingangAus(
  mail: Awaited<ReturnType<typeof PostalMime.parse>> | null,
  umschlag: { from: string; to: string },
  roh: ArrayBuffer,
  zuordnung: Env["ZUORDNUNG"],
  jetzt = new Date(),
): Promise<Eingang> {
  const an = zeile(umschlag.to, 320).toLowerCase();
  const datum = mail?.date ? new Date(mail.date) : jetzt;
  const text = mail?.text?.trim() ? mail.text : mail?.html ? htmlZuText(mail.html) : "";
  return {
    message_id: zeile(mail?.messageId) || `<ohne-id-${await pruefsumme(roh)}@mail-eingang.jnsw.de>`,
    von: adresseText(mail?.from as Mailbox | undefined, umschlag.from),
    an,
    betreff: zeile(mail?.subject) || (mail ? "" : "(Mail nicht lesbar, siehe Kopie)"),
    datum: (Number.isNaN(datum.getTime()) ? jetzt : datum).toISOString(),
    text: text.replace(/\r\n/g, "\n").slice(0, TEXT_MAX),
    projekt: zuordnen(an, zuordnung),
    anhaenge: (mail?.attachments ?? []).slice(0, ANHAENGE_MAX).map((a) => ({
      name: zeile(a.filename, 200) || "ohne Namen",
      groesse: groesse(a.content),
    })),
  };
}

/** Ablegen, je Message-ID und Empfänger einmal; Antwort: neu angelegt? */
export async function speichern(db: D1, e: Eingang, jetzt = new Date()): Promise<boolean> {
  const ergebnis = await db
    .prepare(
      "INSERT OR IGNORE INTO mail_eingang (message_id, empfaenger, absender, betreff, datum, text, projekt," +
        " anhaenge, eingegangen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      e.message_id,
      e.an,
      e.von,
      e.betreff,
      e.datum,
      e.text,
      e.projekt,
      JSON.stringify(e.anhaenge),
      jetzt.toISOString(),
    )
    .run();
  return ergebnis.meta.changes > 0;
}

/** Die Kopie an KOPIE_AN, je Message-ID einmal (auch wenn die Mail an mehrere Adressen ging). */
export async function weiterleiten(message: EingehendeMail, env: Env, e: Eingang): Promise<void> {
  if (!env.KOPIE_AN) {
    console.error("KOPIE_AN fehlt: keine Kopie weitergeleitet.");
    return;
  }
  const schon = await env.DB.prepare(
    "SELECT 1 AS ja FROM mail_eingang WHERE message_id = ? AND weitergeleitet = 1",
  )
    .bind(e.message_id)
    .first();
  if (schon) return;
  await message.forward(env.KOPIE_AN, new Headers({ "X-Mail-Eingang-Projekt": e.projekt }));
  await env.DB.prepare(
    "UPDATE mail_eingang SET weitergeleitet = 1 WHERE message_id = ? AND empfaenger = ?",
  )
    .bind(e.message_id, e.an)
    .run();
}

function nachricht(z: Zeile): Eingang {
  return {
    message_id: z.message_id,
    von: z.absender,
    an: z.empfaenger,
    betreff: z.betreff,
    datum: z.datum,
    text: z.text,
    projekt: z.projekt,
    anhaenge: JSON.parse(z.anhaenge) as Anhang[],
  };
}

/** Eine Zeile an jw-dev; Antwort: neuer Status der Zeile. */
export async function senden(env: Env, z: Zeile, jetzt = new Date()): Promise<string> {
  let status = 0;
  let fehler = "";
  if (!env.JW_DEV_TOKEN || !env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET) {
    fehler = "Secrets fehlen (JW_DEV_TOKEN, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET)";
  } else {
    try {
      const antwort = await fetch(new URL("/api/mail-eingang", env.JW_DEV_URL), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-JW-Dev-Token": env.JW_DEV_TOKEN,
          "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID,
          "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET,
        },
        body: JSON.stringify(nachricht(z)),
        redirect: "manual", // Access leitet ohne gültiges Service Token zur Anmeldung um
        signal: AbortSignal.timeout(15_000),
      });
      status = antwort.status;
      if (!antwort.ok) fehler = `HTTP ${status}`;
    } catch (e) {
      fehler = e instanceof Error ? e.name : "Fehler";
    }
  }
  const neu = !fehler ? "gesendet" : ABGEWIESEN.has(status) ? "abgewiesen" : "offen";
  await env.DB.prepare(
    "UPDATE mail_eingang SET status = ?, versuche = versuche + 1, letzter_fehler = ?," +
      " gesendet = CASE WHEN ? = 'gesendet' THEN ? ELSE gesendet END WHERE id = ?",
  )
    .bind(neu, fehler || null, neu, jetzt.toISOString(), z.id)
    .run();
  if (fehler) console.warn(`mail_eingang ${z.id}: an jw-dev nicht angenommen (${fehler}), ${neu}.`);
  return neu;
}

const SPALTEN = "id, message_id, empfaenger, absender, betreff, datum, text, projekt, anhaenge";

/** Die offenen Mails (älteste zuerst) erneut an jw-dev; Antwort: Zahl je neuem Status. */
export async function offeneSenden(env: Env, jetzt = new Date()): Promise<Record<string, number>> {
  const { results } = await env.DB.prepare(
    `SELECT ${SPALTEN} FROM mail_eingang WHERE status = 'offen' ORDER BY eingegangen, id LIMIT ?`,
  )
    .bind(STAPEL)
    .all<Zeile>();
  const zahlen: Record<string, number> = {};
  for (const z of results) {
    const neu = await senden(env, z, jetzt);
    zahlen[neu] = (zahlen[neu] ?? 0) + 1;
  }
  const grenze = new Date(jetzt.getTime() - TEXT_AUFBEWAHREN_TAGE * 86_400_000).toISOString();
  await env.DB.prepare(
    "UPDATE mail_eingang SET text = '' WHERE status = 'gesendet' AND text != '' AND gesendet < ?",
  )
    .bind(grenze)
    .run();
  return zahlen;
}

async function lesen(roh: ArrayBuffer) {
  try {
    return await PostalMime.parse(roh, { attachmentEncoding: "arraybuffer" });
  } catch (e) {
    console.error(
      `Mail nicht lesbar (${e instanceof Error ? e.name : "Fehler"}); nur Umschlag und Kopie.`,
    );
    return null;
  }
}

export async function annehmen(message: EingehendeMail, env: Env, ctx: Kontext): Promise<void> {
  const roh = await new Response(message.raw).arrayBuffer();
  const e = await eingangAus(await lesen(roh), message, roh, env.ZUORDNUNG);
  await speichern(env.DB, e);
  // Scheitert die Weiterleitung, wirft sie: Der Absender-Server stellt erneut zu, die Zeile bleibt einmal.
  await weiterleiten(message, env, e);
  const z = await env.DB.prepare(
    `SELECT ${SPALTEN} FROM mail_eingang WHERE message_id = ? AND empfaenger = ? AND status = 'offen'`,
  )
    .bind(e.message_id, e.an)
    .first<Zeile>();
  if (z) ctx.waitUntil(senden(env, z));
}

const worker = {
  async email(message: EingehendeMail, env: Env, ctx: Kontext): Promise<void> {
    await annehmen(message, env, ctx);
  },
  async scheduled(_controller: unknown, env: Env, ctx: Kontext): Promise<void> {
    ctx.waitUntil(offeneSenden(env));
  },
};

export default worker;
