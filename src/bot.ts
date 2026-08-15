import { Api, Bot, Context, InlineKeyboard } from "grammy";

import { analyzeDialogue } from "./analyzer.js";
import { config, hasAllowedUsers, isUserAllowed } from "./config.js";
import { formatAudit, splitTelegramMessage } from "./format.js";

interface PendingAlbum {
  context: Context;
  fileIds: string[];
  caption: string;
  timer: NodeJS.Timeout;
}

const pendingAlbums = new Map<string, PendingAlbum>();

function accessMessage(userId: number | undefined): string {
  if (!userId) return "Не удалось определить ваш Telegram ID.";
  if (!hasAllowedUsers()) {
    return `Бот пока закрыт. Ваш Telegram ID: ${userId}. Добавьте его в список разрешённых пользователей при настройке.`;
  }
  return "У вас нет доступа к этому приватному боту.";
}

async function downloadTelegramFile(api: Api, fileId: string): Promise<Buffer> {
  const file = await api.getFile(fileId);
  if (!file.file_path) throw new Error("Telegram не вернул файл");

  const response = await fetch(`https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`);
  if (!response.ok) throw new Error("Не удалось загрузить скриншот");

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > config.maxImageBytes) throw new Error("Один из скриншотов слишком большой");
  return bytes;
}

async function sendAudit(context: Context, text: string, fileIds: string[], mode: "audit" | "reply" | "filter" = "audit") {
  const userId = context.from?.id;
  if (!isUserAllowed(userId)) {
    await context.reply(accessMessage(userId));
    return;
  }

  if (fileIds.length > config.maxImages) {
    await context.reply(`Можно отправить не больше ${config.maxImages} скриншотов за один раз.`);
    return;
  }

  try {
    await context.replyWithChatAction("typing");
    const images = await Promise.all(fileIds.map((fileId) => downloadTelegramFile(context.api, fileId)));
    const result = await analyzeDialogue({ text, images, mode });
    const messages = splitTelegramMessage(formatAudit(result));

    for (const message of messages) await context.reply(message);

    if (config.publicBaseUrl) {
      const keyboard = new InlineKeyboard().webApp("Открыть Luma Mini App", config.publicBaseUrl);
      await context.reply("Полный интерфейс и кнопки копирования:", { reply_markup: keyboard });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    await context.reply(`Не удалось завершить анализ: ${message}`);
  }
}

export function createLumaBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command("start", async (context) => {
    const userId = context.from?.id;
    if (!isUserAllowed(userId)) {
      await context.reply(accessMessage(userId));
      return;
    }

    await context.reply(
      [
        "Luma готова к работе.",
        "",
        "Отправьте текст или альбом из 2–10 скриншотов. Я соберу диалог, найду ошибки и дам три варианта ответа на русском и английском.",
        "",
        "/audit — полный аудит",
        "/reply — варианты ответа",
        "/filter — проверка текста перед отправкой",
        "/forget — очистить временный результат",
      ].join("\n"),
    );
  });

  bot.command("help", async (context) => {
    await context.reply("Пришлите переписку текстом или одним альбомом скриншотов. Ничего клиенту автоматически не отправляется.");
  });

  bot.command("forget", async (context) => {
    await context.reply("Временные данные этой проверки очищены. Постоянная история ботом не ведётся.");
  });

  for (const [command, mode] of [
    ["audit", "audit"],
    ["reply", "reply"],
    ["filter", "filter"],
  ] as const) {
    bot.command(command, async (context) => {
      const text = context.match?.trim() ?? "";
      if (!text) {
        await context.reply("Добавьте текст после команды или отправьте переписку следующим сообщением.");
        return;
      }
      await sendAudit(context, text, [], mode);
    });
  }

  bot.on("message:photo", async (context) => {
    const userId = context.from?.id;
    if (!isUserAllowed(userId)) {
      await context.reply(accessMessage(userId));
      return;
    }

    const photo = context.message.photo.at(-1);
    if (!photo) return;
    const groupId = context.message.media_group_id;

    if (!groupId) {
      await sendAudit(context, context.message.caption ?? "", [photo.file_id]);
      return;
    }

    const existing = pendingAlbums.get(groupId);
    if (existing) {
      clearTimeout(existing.timer);
      if (!existing.fileIds.includes(photo.file_id)) existing.fileIds.push(photo.file_id);
      if (context.message.caption) existing.caption = context.message.caption;
      existing.timer = setTimeout(() => {
        pendingAlbums.delete(groupId);
        void sendAudit(existing.context, existing.caption, existing.fileIds);
      }, 1400);
      return;
    }

    const album: PendingAlbum = {
      context,
      fileIds: [photo.file_id],
      caption: context.message.caption ?? "",
      timer: setTimeout(() => {
        pendingAlbums.delete(groupId);
        void sendAudit(context, context.message.caption ?? "", album.fileIds);
      }, 1400),
    };
    pendingAlbums.set(groupId, album);
  });

  bot.on("message:text", async (context) => {
    if (context.message.text.startsWith("/")) return;
    await sendAudit(context, context.message.text, []);
  });

  bot.catch(({ error }) => {
    const message = error instanceof Error ? error.message : "Telegram bot error";
    console.error(`[bot] ${message}`);
  });

  return bot;
}
