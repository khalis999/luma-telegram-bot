import dotenv from "dotenv";

dotenv.config({ path: process.env.ENV_FILE ?? ".env.local", quiet: true });
dotenv.config({ quiet: true });

function parseIds(value: string | undefined): Set<number> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => Number.parseInt(item.trim(), 10))
      .filter((item) => Number.isSafeInteger(item) && item > 0),
  );
}

function parseBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function cleanBaseUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

export const config = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  telegramBotToken: (process.env.TELEGRAM_BOT_TOKEN ?? "").trim(),
  telegramAllowedUserIds: parseIds(process.env.TELEGRAM_ALLOWED_USER_IDS),
  telegramWebhookSecret: (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim(),
  publicBaseUrl: cleanBaseUrl(process.env.PUBLIC_BASE_URL),
  openAiApiKey: (process.env.OPENAI_API_KEY ?? "").trim(),
  openAiModel: (process.env.OPENAI_MODEL ?? "gpt-5.4-mini").trim(),
  allowDevWeb: parseBoolean(process.env.ALLOW_DEV_WEB),
  maxImages: 10,
  maxImageBytes: 12 * 1024 * 1024,
};

export function hasAllowedUsers(): boolean {
  return config.telegramAllowedUserIds.size > 0;
}

export function isUserAllowed(userId: number | undefined): boolean {
  return userId !== undefined && config.telegramAllowedUserIds.has(userId);
}
