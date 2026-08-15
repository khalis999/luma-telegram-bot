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

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseHour(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : fallback;
}

function cleanBaseUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function resolvePublicBaseUrl(): string {
  const configured = cleanBaseUrl(process.env.PUBLIC_BASE_URL);
  if (configured) return configured;

  // Replit exposes a temporary HTTPS domain while the workspace is running.
  // Using it automatically makes the Telegram Mini App available during setup,
  // without copying an address into a secret by hand. A production deployment
  // should still define PUBLIC_BASE_URL explicitly.
  const replitDomain = (process.env.REPLIT_DEV_DOMAIN ?? "").trim();
  return replitDomain ? `https://${replitDomain}` : "";
}

export const config = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  telegramBotToken: (process.env.TELEGRAM_BOT_TOKEN ?? "").trim(),
  telegramAllowedUserIds: parseIds(process.env.TELEGRAM_ALLOWED_USER_IDS),
  telegramWebhookSecret: (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim(),
  publicBaseUrl: resolvePublicBaseUrl(),
  openAiApiKey: (process.env.OPENAI_API_KEY ?? "").trim(),
  openAiModel: (process.env.OPENAI_MODEL ?? "gpt-5.4-mini").trim(),
  transcriptionModel: (process.env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe").trim(),
  dailySpendLimitUsd: parsePositiveNumber(process.env.DAILY_SPEND_LIMIT_USD, 0.5),
  dailyReportHour: parseHour(process.env.DAILY_REPORT_HOUR, 20),
  reportTimeZone: (process.env.REPORT_TIME_ZONE ?? "Asia/Makassar").trim(),
  allowDevWeb: parseBoolean(process.env.ALLOW_DEV_WEB),
  localWebOnly: parseBoolean(process.env.LUMA_LOCAL_WEB_ONLY),
  maxImages: 10,
  maxImageBytes: 12 * 1024 * 1024,
  maxVoiceBytes: 20 * 1024 * 1024,
};

export function hasAllowedUsers(): boolean {
  return config.telegramAllowedUserIds.size > 0;
}

export function isUserAllowed(userId: number | undefined): boolean {
  return userId !== undefined && config.telegramAllowedUserIds.has(userId);
}
