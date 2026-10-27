import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker, {
  UNZUGEORDNET,
  annehmen,
  htmlZuText,
  offeneSenden,
  zuordnen,
  type D1,
  type D1Abfrage,
  type EingehendeMail,
  type Env,
} from "../worker/mail-eingang";

/** D1 über node:sqlite, mit der echten Migration des Workers. */
function d1(): { db: D1; roh: DatabaseSync } {
  const roh = new DatabaseSync(":memory:");
  roh.exec(
    readFileSync(
      new URL("../worker/mail-eingang-migrations/0001_mail_eingang.sql", import.meta.url),
      "utf8",
    ),
  );
  const abfrage = (sql: string, werte: unknown[] = []): D1Abfrage => ({
    bind: (...neu: unknown[]) => abfrage(sql, neu),
    run: async () => ({
      meta: { changes: Number(roh.prepare(sql).run(...(werte as never[])).changes) },
    }),
    first: async <T>() => (roh.prepare(sql).get(...(werte as never[])) as T) ?? null,
    all: async <T>() => ({ results: roh.prepare(sql).all(...(werte as never[])) as T[] }),
  });
  return { db: { prepare: (sql) => abfrage(sql) }, roh };
}

const MIME = [
  "From: Praxis Beispiel <praxis@example.org>",
  "To: mymvz@jnsw.de",
  "Subject: =?UTF-8?Q?Bitte_=C3=96ffnungszeiten_=C3=A4ndern?=",
  "Date: Tue, 27 Oct 2026 18:58:00 +0100",
  "Message-ID: <CAB12345@mail.example.org>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="g"',
  "",
  "--g",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hallo,",
  "bitte ab November dienstags bis 19 Uhr.",
  "--g",
  'Content-Type: application/pdf; name="plan.pdf"',
  'Content-Disposition: attachment; filename="plan.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("x".repeat(3000)).toString("base64"),
  "--g--",
  "",
].join("\r\n");

function mail(to = "mymvz@jnsw.de", inhalt = MIME) {
  const weiter: string[] = [];
  const message: EingehendeMail = {
    from: "bounce+abc@example.org",
    to,
    raw: new Response(inhalt).body!,
    rawSize: inhalt.length,
    forward: async (ziel) => {
      weiter.push(ziel);
    },
  };
  return { message, weiter };
}

function umgebung(db: D1): Env {
  return {
    DB: db,
    KOPIE_AN: "ich@example.org",
    ZUORDNUNG: { "MyMVZ@jnsw.de": "mymvz-wordpress" },
    JW_DEV_URL: "https://orga.example.de",
    JW_DEV_TOKEN: "mail-token",
    CF_ACCESS_CLIENT_ID: "id.access",
    CF_ACCESS_CLIENT_SECRET: "geheim",
  };
}

/** fetch durch eine Liste von Antworten ersetzen; gibt die Aufrufe zurück. */
function dienst(...antworten: (number | Error)[]) {
  const aufrufe: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: URL | string, init: RequestInit) => {
    aufrufe.push({ url: String(url), init });
    const naechste = antworten.shift() ?? 200;
    if (naechste instanceof Error) throw naechste;
    return new Response("{}", { status: naechste });
  }) as typeof fetch;
  return aufrufe;
}

function kontext() {
  const offen: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => void offen.push(p) },
    fertig: () => Promise.all(offen),
  };
}

test("assigns the project by recipient address", () => {
  assert.equal(
    zuordnen("mymvz@JNSW.de", { "MyMVZ@jnsw.de": "mymvz-wordpress" }),
    "mymvz-wordpress",
  );
  assert.equal(zuordnen("info@jnsw.de", '{"mymvz@jnsw.de": "mymvz-wordpress"}'), UNZUGEORDNET);
  assert.equal(
    zuordnen("mymvz@jnsw.de", '{"mymvz@jnsw.de": "mymvz-wordpress"}'),
    "mymvz-wordpress",
  );
  assert.equal(zuordnen("mymvz@jnsw.de", "kein json"), UNZUGEORDNET);
  assert.equal(zuordnen("mymvz@jnsw.de", undefined), UNZUGEORDNET);
});

test("turns HTML into plain text when a mail has no text part", () => {
  assert.equal(
    htmlZuText("<style>p{}</style><p>Hallo &amp; danke</p><p>Zeile<br>zwei</p>"),
    "Hallo & danke\nZeile\nzwei",
  );
});

test("stores, forwards a copy and delivers to jw-dev, once per message", async () => {
  const { db, roh } = d1();
  const env = umgebung(db);
  const aufrufe = dienst(200);
  const { message, weiter } = mail();
  const { ctx, fertig } = kontext();
  await worker.email(message, env, ctx);
  await fertig();

  assert.deepEqual(weiter, ["ich@example.org"]);
  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0].url, "https://orga.example.de/api/mail-eingang");
  const kopf = aufrufe[0].init.headers as Record<string, string>;
  assert.equal(kopf["X-JW-Dev-Token"], "mail-token");
  assert.equal(kopf["CF-Access-Client-Id"], "id.access");
  assert.equal(kopf["CF-Access-Client-Secret"], "geheim");
  assert.deepEqual(JSON.parse(String(aufrufe[0].init.body)), {
    message_id: "<CAB12345@mail.example.org>",
    von: "Praxis Beispiel <praxis@example.org>",
    an: "mymvz@jnsw.de",
    betreff: "Bitte Öffnungszeiten ändern",
    datum: "2026-10-27T17:58:00.000Z",
    text: "Hallo,\nbitte ab November dienstags bis 19 Uhr.",
    projekt: "mymvz-wordpress",
    anhaenge: [{ name: "plan.pdf", groesse: 3000 }],
  });
  const zeile = roh
    .prepare("SELECT status, weitergeleitet, versuche, gesendet FROM mail_eingang")
    .get() as Record<string, unknown>;
  assert.equal(zeile.status, "gesendet");
  assert.equal(zeile.weitergeleitet, 1);
  assert.equal(zeile.versuche, 1);
  assert.ok(zeile.gesendet);

  // Dieselbe Mail noch einmal (Wiederholung des Absender-Servers): keine zweite Kopie, kein zweites Senden.
  const zweit = mail();
  const k2 = kontext();
  await worker.email(zweit.message, env, k2.ctx);
  await k2.fertig();
  assert.deepEqual(zweit.weiter, []);
  assert.equal(aufrufe.length, 1);
  // An eine zweite Adresse: eigene Zeile, unzugeordnet, aber nur eine Kopie je Message-ID.
  const dritt = mail("info@jnsw.de");
  const k3 = kontext();
  await worker.email(dritt.message, env, k3.ctx);
  await k3.fertig();
  assert.deepEqual(dritt.weiter, []);
  assert.equal(JSON.parse(String(aufrufe[1].init.body)).projekt, UNZUGEORDNET);
  assert.equal(roh.prepare("SELECT count(*) AS n FROM mail_eingang").get()?.n, 2);
});

test("keeps mails open while jw-dev is down and the cron sends them later", async () => {
  const { db, roh } = d1();
  const env = umgebung(db);
  const aufrufe = dienst(530, new TypeError("fetch failed"));
  const { ctx, fertig } = kontext();
  await annehmen(mail().message, env, ctx);
  await fertig();
  assert.equal(roh.prepare("SELECT status FROM mail_eingang").get()?.status, "offen");

  assert.deepEqual(await offeneSenden(env), { offen: 1 }); // Netzfehler: bleibt offen
  dienst(200);
  assert.deepEqual(await offeneSenden(env), { gesendet: 1 });
  assert.deepEqual(await offeneSenden(env), {});
  assert.equal(aufrufe.length, 2);
  const zeile = roh.prepare("SELECT status, versuche, letzter_fehler FROM mail_eingang").get();
  assert.deepEqual({ ...zeile }, { status: "gesendet", versuche: 3, letzter_fehler: null });
});

test("does not retry a mail jw-dev rejects as invalid, and clears old texts", async () => {
  const { db, roh } = d1();
  const env = umgebung(db);
  dienst(400);
  const { ctx, fertig } = kontext();
  await annehmen(mail().message, env, ctx);
  await fertig();
  assert.equal(roh.prepare("SELECT status FROM mail_eingang").get()?.status, "abgewiesen");
  assert.deepEqual(await offeneSenden(env), {});

  roh.exec("UPDATE mail_eingang SET status = 'gesendet', gesendet = '2026-09-01T00:00:00.000Z'");
  await offeneSenden(env, new Date("2026-10-27T00:00:00Z"));
  assert.equal(roh.prepare("SELECT text FROM mail_eingang").get()?.text, "");
});

test("without secrets nothing is sent and the mail stays open", async () => {
  const { db, roh } = d1();
  const env = { ...umgebung(db), JW_DEV_TOKEN: undefined, KOPIE_AN: undefined };
  const aufrufe = dienst(200);
  const { message, weiter } = mail();
  const { ctx, fertig } = kontext();
  await annehmen(message, env, ctx);
  await fertig();
  assert.equal(aufrufe.length, 0);
  assert.deepEqual(weiter, []);
  assert.equal(roh.prepare("SELECT status FROM mail_eingang").get()?.status, "offen");
});

test("a mail without Message-ID gets a stable id from its checksum", async () => {
  const { db, roh } = d1();
  const env = umgebung(db);
  dienst(200);
  const kaputt = "kein MIME";
  const { message, weiter } = mail("mymvz@jnsw.de", kaputt);
  const { ctx, fertig } = kontext();
  await annehmen(message, env, ctx);
  await fertig();
  assert.deepEqual(weiter, ["ich@example.org"]);
  const id = String(roh.prepare("SELECT message_id FROM mail_eingang").get()?.message_id);
  assert.match(id, /^<.+@.+>$/);
  const nochmal = mail("mymvz@jnsw.de", kaputt);
  await annehmen(nochmal.message, env, kontext().ctx);
  assert.equal(roh.prepare("SELECT count(*) AS n FROM mail_eingang").get()?.n, 1);
});
