import { fileURLToPath } from "node:url";
import path from "node:path";

import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { webhookCallback } from "grammy";
import helmet from "helmet";
import multer from "multer";

import { analyzeDialogue } from "./analyzer.js";
import { createLumaBot } from "./bot.js";
import { config, isUserAllowed } from "./config.js";
import { validateTelegramInitData } from "./telegram-auth.js";

const app = express();
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(currentDirectory, "../public");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: config.maxImages, fileSize: config.maxImageBytes },
  fileFilter: (_request, file, callback) => {
    callback(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype));
  },
});

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://telegram.org"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'self'", "https://web.telegram.org", "https://*.telegram.org"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDirectory, { index: "index.html", maxAge: "1h" }));
app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);

function webAuth(request: Request, response: Response, next: NextFunction) {
  if (config.allowDevWeb) {
    next();
    return;
  }

  const initDataHeader = request.header("x-telegram-init-data") ?? "";
  const identity = validateTelegramInitData(initDataHeader, config.telegramBotToken);
  if (!identity.valid || !isUserAllowed(identity.userId)) {
    response.status(401).json({ error: "Доступ разрешён только через приватный Telegram Mini App." });
    return;
  }

  next();
}

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    telegramConfigured: Boolean(config.telegramBotToken),
    aiConfigured: Boolean(config.openAiApiKey),
    miniAppConfigured: Boolean(config.publicBaseUrl),
  });
});

app.post("/api/audit", webAuth, upload.array("screenshots", config.maxImages), async (request, response) => {
  try {
    const files = (request.files as Express.Multer.File[] | undefined) ?? [];
    const text = typeof request.body.text === "string" ? request.body.text : "";
    const mode = request.body.mode === "reply" || request.body.mode === "filter" ? request.body.mode : "audit";
    const result = await analyzeDialogue({ text, images: files.map((file) => file.buffer), mode });
    response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось выполнить анализ";
    response.status(400).json({ error: message });
  }
});

let bot: ReturnType<typeof createLumaBot> | undefined;
if (config.telegramBotToken) {
  bot = createLumaBot(config.telegramBotToken);
  const webhookSecret = config.telegramWebhookSecret;

  if (config.publicBaseUrl) {
    app.use(
      "/telegram/webhook",
      (request, response, next) => {
        if (webhookSecret && request.header("x-telegram-bot-api-secret-token") !== webhookSecret) {
          response.sendStatus(401);
          return;
        }
        next();
      },
      webhookCallback(bot, "express"),
    );
  }
}

const server = app.listen(config.port, async () => {
  console.log(`[luma] server listening on port ${config.port}`);

  if (!bot) {
    console.log("[luma] Telegram token is not configured; web health check only");
    return;
  }

  await bot.api.setMyCommands([
    { command: "start", description: "Открыть Luma" },
    { command: "audit", description: "Полный аудит текста" },
    { command: "reply", description: "Три варианта ответа" },
    { command: "filter", description: "Проверить перед отправкой" },
    { command: "forget", description: "Очистить временные данные" },
  ]);

  if (config.publicBaseUrl) {
    const webhookOptions = config.telegramWebhookSecret
      ? { secret_token: config.telegramWebhookSecret }
      : undefined;
    await bot.api.setWebhook(`${config.publicBaseUrl}/telegram/webhook`, webhookOptions);
    await bot.api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "Открыть Luma",
        web_app: { url: config.publicBaseUrl },
      },
    });
    console.log("[luma] Telegram webhook and Mini App menu configured");
  } else {
    void bot.start({ onStart: () => console.log("[luma] Telegram long polling started") });
  }
});

async function shutdown(signal: string) {
  console.log(`[luma] shutting down after ${signal}`);
  bot?.stop();
  server.close(() => process.exit(0));
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
