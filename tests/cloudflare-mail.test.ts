import assert from "node:assert/strict";
import test from "node:test";
import {
  argumente,
  catchAllPasst,
  catchAllRegel,
  fehlendeEintraege,
  fqdn,
  mailgunAbloesen,
  txtValue,
} from "../scripts/cloudflare-mail.mjs";
import { emailBindingMessage, emailServiceApiBody, verificationEmail } from "../app/mail-message";

const domain = "jnsw.de";

test("normalizes record names and TXT values", () => {
  assert.equal(fqdn("@", domain), domain);
  assert.equal(fqdn("JNSW.DE.", domain), domain);
  assert.equal(fqdn("cf-bounce", domain), "cf-bounce.jnsw.de");
  assert.equal(fqdn("cf-bounce.jnsw.de", domain), "cf-bounce.jnsw.de");
  assert.equal(txtValue('"v=spf1 include:mailgun.org ~all"'), "v=spf1 include:mailgun.org ~all");
  assert.equal(txtValue('"v=DKIM1; k=rsa; p=AB" "CD"'), "v=DKIM1; k=rsa; p=ABCD");
});

test("removes Mailgun MX, SPF and tracking CNAME but keeps unrelated records", () => {
  const records = [
    { id: "1", type: "MX", name: "jnsw.de", content: "mxa.eu.mailgun.org", priority: 10 },
    { id: "2", type: "MX", name: "jnsw.de", content: "mxb.eu.mailgun.org", priority: 10 },
    { id: "3", type: "TXT", name: "jnsw.de", content: '"v=spf1 include:mailgun.org ~all"' },
    { id: "4", type: "CNAME", name: "email.jnsw.de", content: "eu.mailgun.org" },
    { id: "5", type: "TXT", name: "mta._domainkey.jnsw.de", content: "k=rsa; p=MIGf" },
    { id: "6", type: "CNAME", name: "www.jnsw.de", content: "custom-domains.chatgpt.site" },
    { id: "7", type: "TXT", name: "jnsw.de", content: "google-site-verification=abc" },
    { id: "8", type: "MX", name: "jnsw.de", content: "route1.mx.cloudflare.net", priority: 5 },
  ];
  const { loeschen, warnungen } = mailgunAbloesen(records, domain);
  assert.deepEqual(
    loeschen.map((l) => l.record.id),
    ["1", "2", "3", "4"],
  );
  assert.equal(warnungen.length, 1);
  assert.match(warnungen[0], /mta\._domainkey/);
});

test("keeps a Cloudflare SPF record and warns about extra senders in an old one", () => {
  const cloudflareSpf = {
    id: "1",
    type: "TXT",
    name: "jnsw.de",
    content: "v=spf1 include:_spf.mx.cloudflare.net ~all",
  };
  assert.equal(mailgunAbloesen([cloudflareSpf], domain).loeschen.length, 0);
  const mixed = {
    id: "2",
    type: "TXT",
    name: "jnsw.de",
    content: "v=spf1 include:mailgun.org include:spf.protection.outlook.com ~all",
  };
  const { loeschen, warnungen } = mailgunAbloesen([mixed], domain);
  assert.equal(loeschen.length, 1);
  assert.match(warnungen[0], /spf\.protection\.outlook\.com/);
});

test("finds expected records that are missing in the zone", () => {
  const expected = [
    { type: "MX", name: "jnsw.de", content: "route1.mx.cloudflare.net", priority: 13 },
    { type: "TXT", name: "jnsw.de", content: "v=spf1 include:_spf.mx.cloudflare.net ~all" },
    { type: "TXT", name: "cf-bounce._domainkey", content: "v=DKIM1; p=XYZ" },
  ];
  const existing = [
    { type: "MX", name: "jnsw.de", content: "route1.mx.cloudflare.net." },
    { type: "TXT", name: "jnsw.de", content: '"v=spf1 include:_spf.mx.cloudflare.net ~all"' },
  ];
  assert.deepEqual(
    fehlendeEintraege(expected, existing, domain).map((r) => r.name),
    ["cf-bounce._domainkey"],
  );
});

test("parses script arguments", () => {
  const opts = argumente([
    "--domain",
    "JNSW.DE",
    "--weiterleiten-an",
    "ich@example.org",
    "--anwenden",
  ]);
  assert.equal(opts.domain, "jnsw.de");
  assert.equal(opts.ziel, "ich@example.org");
  assert.equal(opts.anwenden, true);
  assert.throws(() => argumente(["--unbekannt"]), /Unbekanntes Argument/);
});

test("catch-all goes to the mail intake worker with --an-worker, otherwise forwards", () => {
  const opts = argumente([
    "--weiterleiten-an",
    "ich@example.org",
    "--an-worker",
    "jnsw-mail-eingang",
  ]);
  assert.equal(opts.worker, "jnsw-mail-eingang");
  const worker = catchAllRegel(opts);
  assert.deepEqual(worker.actions, [{ type: "worker", value: ["jnsw-mail-eingang"] }]);
  assert.deepEqual(worker.matchers, [{ type: "all" }]);
  assert.deepEqual(catchAllRegel({ ziel: "ich@example.org" }).actions, [
    { type: "forward", value: ["ich@example.org"] },
  ]);
  assert.equal(catchAllRegel({}), null);

  const alt = { enabled: true, actions: [{ type: "forward", value: ["ich@example.org"] }] };
  assert.equal(catchAllPasst(alt, worker), false);
  assert.equal(catchAllPasst(alt, catchAllRegel({ ziel: "ich@example.org" })), true);
  assert.equal(catchAllPasst({ ...worker, enabled: false }, worker), false);
  assert.equal(catchAllPasst(worker, worker), true);
  assert.equal(catchAllPasst(null, worker), false);
});

test("builds Cloudflare Email Service messages for binding and REST API", () => {
  const message = verificationEmail("user@example.org", "https://jnsw.de/verify-email?token=a&b");
  assert.match(message.html, /token=a&amp;b/);
  assert.match(message.text, /token=a&b/);
  const api = emailServiceApiBody(message, "service@jnsw.de");
  assert.deepEqual(api.from, { address: "service@jnsw.de", name: "JNSW.DE" });
  assert.equal(api.to, "user@example.org");
  const binding = emailBindingMessage(message, "service@jnsw.de");
  assert.deepEqual(binding.from, { email: "service@jnsw.de", name: "JNSW.DE" });
  assert.equal(binding.subject, message.subject);
});
