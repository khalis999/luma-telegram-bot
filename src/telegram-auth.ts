import { createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramIdentity {
  valid: boolean;
  userId?: number;
}

export function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 15 * 60,
): TelegramIdentity {
  if (!initData || !botToken) return { valid: false };

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) return { valid: false };
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculatedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const receivedBuffer = Buffer.from(receivedHash, "hex");
  if (receivedBuffer.length !== calculatedHash.length || !timingSafeEqual(receivedBuffer, calculatedHash)) {
    return { valid: false };
  }

  const authDate = Number.parseInt(params.get("auth_date") ?? "0", 10);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || authDate <= 0 || Math.abs(nowSeconds - authDate) > maxAgeSeconds) {
    return { valid: false };
  }

  try {
    const user = JSON.parse(params.get("user") ?? "{}") as { id?: number };
    const userId = user.id;
    return typeof userId === "number" && Number.isSafeInteger(userId)
      ? { valid: true, userId }
      : { valid: false };
  } catch {
    return { valid: false };
  }
}
