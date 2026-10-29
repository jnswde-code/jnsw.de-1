export const DEFAULT_SENDER = "service@jnsw.de";
export const SENDER_NAME = "JNSW.DE";

export type OutgoingEmail = { to: string; subject: string; text: string; html: string };

function verificationEmailHtml(verificationUrl: string) {
  const safeUrl = verificationUrl
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html><html lang="de"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="dark" /><meta name="supported-color-schemes" content="dark" /><title>E-Mail-Adresse bestätigen · JNSW.DE</title></head><body style="margin:0;padding:0;background:#08080a;color:#f4f0e7;font-family:Manrope,Arial,sans-serif;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#08080a;"><tr><td style="padding:32px 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;margin:0 auto;background:#0d0d10;border:1px solid #2a2a30;"><tr><td style="padding:32px 32px 24px;border-bottom:1px solid #2a2a30;font-family:'DM Mono',Consolas,monospace;font-size:12px;letter-spacing:.08em;line-height:1.4;color:#b8ff62;">JNSW.DE / KONTO</td></tr><tr><td style="padding:40px 32px 32px;"><p style="margin:0 0 16px;font-family:'DM Mono',Consolas,monospace;font-size:12px;letter-spacing:.08em;line-height:1.4;color:#aaa8a2;">REGISTRIERUNG</p><h1 style="margin:0 0 20px;color:#f4f0e7;font-family:Manrope,Arial,sans-serif;font-size:36px;font-weight:700;letter-spacing:-.04em;line-height:1.05;">Bestätige deine<br />E-Mail-Adresse<span style="color:#b8ff62;">.</span></h1><p style="margin:0 0 28px;color:#d0cec8;font-size:16px;line-height:1.6;">Willkommen bei JNSW.DE. Dieser Klick bestätigt deine E-Mail-Adresse, schaltet dein Konto frei und führt dich zur Community.</p><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:#b8ff62;"><a href="${safeUrl}" style="display:inline-block;padding:14px 20px;color:#08080a;font-family:'DM Mono',Consolas,monospace;font-size:13px;font-weight:700;letter-spacing:.02em;line-height:1.2;text-decoration:none;">E-MAIL-ADRESSE BESTÄTIGEN →</a></td></tr></table><p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #2a2a30;color:#aaa8a2;font-size:13px;line-height:1.6;">Der Link ist 24 Stunden gültig und kann nur einmal verwendet werden. Falls du kein Konto erstellt hast, kannst du diese E-Mail ignorieren.</p></td></tr><tr><td style="padding:24px 32px;background:#15151a;border-top:1px solid #2a2a30;color:#aaa8a2;font-family:'DM Mono',Consolas,monospace;font-size:11px;letter-spacing:.03em;line-height:1.6;">JNSW.DE · Berlin / Germany<br /><a href="mailto:hello@jnsw.de" style="color:#f4f0e7;text-decoration:underline;">hello@jnsw.de</a></td></tr></table></td></tr></table></body></html>`;
}

export function verificationEmail(to: string, verificationUrl: string): OutgoingEmail {
  return {
    to,
    subject: "Bestätige deine E-Mail-Adresse für JNSW.DE",
    text: `Willkommen bei JNSW.DE.\n\nBestätige deine E-Mail-Adresse, schalte dein Konto frei und gelange zur Community:\n${verificationUrl}\n\nDer Link ist 24 Stunden gültig und kann nur einmal verwendet werden. Falls du kein Konto erstellt hast, kannst du diese E-Mail ignorieren.\n\nJNSW.DE · Berlin / Germany\nhello@jnsw.de`,
    html: verificationEmailHtml(verificationUrl),
  };
}

/** Body for POST /accounts/{account_id}/email/sending/send (Cloudflare Email Service REST API). */
export function emailServiceApiBody(message: OutgoingEmail, from: string) {
  return {
    from: { address: from, name: SENDER_NAME },
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  };
}

/** Message for the Workers `send_email` binding (`env.EMAIL.send(...)`). */
export function emailBindingMessage(message: OutgoingEmail, from: string) {
  return {
    from: { email: from, name: SENDER_NAME },
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  };
}
