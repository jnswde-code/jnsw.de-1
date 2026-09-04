import { env } from "cloudflare:workers";
import { AccessToken } from "livekit-server-sdk";
import { requireActiveUser } from "../../../auth";
import { isSameOrigin } from "../../../request-security";

function livekitConfig() {
  const url = env.LIVEKIT_URL;
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;
  if (
    typeof url !== "string" ||
    typeof apiKey !== "string" ||
    typeof apiSecret !== "string" ||
    !url ||
    !apiKey ||
    !apiSecret
  )
    return null;
  return { url, apiKey, apiSecret };
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const user = await requireActiveUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const config = livekitConfig();
  if (!config)
    return Response.json({ error: "Support-KI ist noch nicht konfiguriert." }, { status: 503 });

  const room = `support-${user.id}-${crypto.randomUUID().slice(0, 8)}`;
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: user.id,
    name: user.displayName,
    ttl: "10m",
  });
  token.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });

  return Response.json({ url: config.url, token: await token.toJwt() });
}
