import { env } from "cloudflare:workers";
import {
  DEFAULT_SENDER,
  emailBindingMessage,
  emailServiceApiBody,
  type OutgoingEmail,
  verificationEmail,
} from "./mail-message";

// Versand über Cloudflare Email Service (siehe docs/email-versand.md):
// bevorzugt über das Workers-Binding `EMAIL` (send_email in wrangler.production.jsonc),
// sonst über die REST-API mit CLOUDFLARE_ACCOUNT_ID und CLOUDFLARE_EMAIL_API_TOKEN.
type SendEmailBinding = { send(message: ReturnType<typeof emailBindingMessage>): Promise<unknown> };

function optionalSecret(
  name: "MAIL_FROM" | "CLOUDFLARE_ACCOUNT_ID" | "CLOUDFLARE_EMAIL_API_TOKEN",
) {
  const value = env[name];
  return typeof value === "string" && value ? value : null;
}

function emailBinding(): SendEmailBinding | null {
  const binding = env.EMAIL as SendEmailBinding | undefined;
  return binding && typeof binding.send === "function" ? binding : null;
}

async function sendEmail(message: OutgoingEmail) {
  const from = optionalSecret("MAIL_FROM") ?? DEFAULT_SENDER;
  const binding = emailBinding();
  if (binding) {
    await binding.send(emailBindingMessage(message, from));
    return;
  }
  const accountId = optionalSecret("CLOUDFLARE_ACCOUNT_ID");
  const apiToken = optionalSecret("CLOUDFLARE_EMAIL_API_TOKEN");
  if (!accountId || !apiToken)
    throw new Error("Missing EMAIL binding or CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_EMAIL_API_TOKEN");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(emailServiceApiBody(message, from)),
    },
  );
  const result = (await response.json().catch(() => null)) as { success?: boolean } | null;
  if (!response.ok || !result?.success)
    throw new Error(`Cloudflare Email Service rejected the email (${response.status})`);
}

export async function sendVerificationEmail({
  to,
  verificationUrl,
}: {
  to: string;
  verificationUrl: string;
}) {
  await sendEmail(verificationEmail(to, verificationUrl));
}
