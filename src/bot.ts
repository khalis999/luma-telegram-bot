import { Api, Bot, Context, InlineKeyboard, Keyboard } from "grammy";

import { analyzeDialogue } from "./analyzer.js";
import { findTemplate, STARTER_TEMPLATES, WORKFLOW_STAGES } from "./catalog.js";
import { config, hasAllowedUsers, isUserAllowed } from "./config.js";
import { formatAudit, splitTelegramMessage } from "./format.js";
import type { MemberFact } from "./types.js";

type AnalysisMode = "audit" | "reply" | "filter";

interface UserWorkspace {
  mode: AnalysisMode;
  facts: MemberFact[];
  stage?: string;
}

interface PendingAlbum {
  context: Context;
  fileIds: string[];
  caption: string;
  mode: AnalysisMode;
  timer: NodeJS.Timeout;
}

const pendingAlbums = new Map<string, PendingAlbum>();
const workspaces = new Map<number, UserWorkspace>();

function mainMenu(): Keyboard {
  return new Keyboard()
    .text("🧠 Аудит").text("✍️ Ответ").text("🛡 Фильтр").row()
    .text("👤 Карточка").text("📚 Шаблоны").text("🗓 План").row()
    .text("📊 Статус").text("❓ Помощь")
    .resized()
    .persistent();
}

function accessMessage(userId: number | undefined): string {
  if (!userId) return "Не удалось определить ваш ID.";
  if (!hasAllowedUsers()) return `Бот пока закрыт. Ваш ID: ${userId}. Добавьте его в список разрешённых при настройке.`;
  return "У вас нет доступа к этому приватному боту.";
}

function workspace(userId: number): UserWorkspace {
  const existing = workspaces.get(userId);
  if (existing) return existing;
  const next: UserWorkspace = { mode: "audit", facts: [] };
  workspaces.set(userId, next);
  return next;
}

function currentMode(context: Context): AnalysisMode {
  const userId = context.from?.id;
  return userId ? workspace(userId).mode : "audit";
}

function modeCopy(mode: AnalysisMode): string {
  if (mode === "reply") return "Режим «Ответ»: пришлите текст или скриншоты — подготовлю 3 варианта на русском и английском.";
  if (mode === "filter") return "Режим «Фильтр»: пришлите текст — проверю его перед отправкой и предложу безопасную замену.";
  return "Режим «Аудит»: пришлите текст или до 10 скриншотов одним альбомом.";
}

async function setMode(context: Context, mode: AnalysisMode): Promise<void> {
  const userId = context.from?.id;
  if (!userId) return;
  workspace(userId).mode = mode;
  await context.reply(modeCopy(mode), { reply_markup: mainMenu() });
}

function saveFacts(userId: number | undefined, facts: MemberFact[], stage: string): void {
  if (!userId) return;
  const state = workspace(userId);
  state.stage = stage;
  state.facts = facts
    .filter((fact) => fact.confidence !== "low" && fact.field.trim() && fact.value.trim())
    .slice(0, 12);
}

async function downloadTelegramFile(api: Api, fileId: string): Promise<Buffer> {
  const file = await api.getFile(fileId);
  if (!file.file_path) throw new Error("Сервис не вернул файл");
  const response = await fetch(`https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`);
  if (!response.ok) throw new Error("Не удалось загрузить скриншот");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > config.maxImageBytes) throw new Error("Один из скриншотов слишком большой");
  return bytes;
}

async function sendAudit(context: Context, text: string, fileIds: string[], mode = currentMode(context)): Promise<void> {
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
    saveFacts(userId, result.memberFacts, result.stage);
    for (const message of splitTelegramMessage(formatAudit(result))) await context.reply(message);

    if (config.publicBaseUrl) {
      const keyboard = new InlineKeyboard().webApp("Открыть Luma", config.publicBaseUrl);
      await context.reply("Полный интерфейс: анализ, карточка и копирование ответов.", { reply_markup: keyboard });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    await context.reply(`Не удалось завершить анализ: ${message}`);
  }
}

function templatesKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const item of STARTER_TEMPLATES) keyboard.text(item.title, `template:${item.id}`).row();
  return keyboard;
}

function cardText(state: UserWorkspace): string {
  if (state.facts.length === 0) {
    return "Карточка пока пуста. После аудита сюда попадут только подтверждённые, несенситивные факты из диалога. Она хранится только пока работает бот.";
  }
  const lines = ["👤 Карточка клиента", state.stage ? `Этап: ${state.stage}` : ""];
  state.facts.forEach((fact) => lines.push(`• ${fact.field}: ${fact.value}`));
  lines.push("", "Проверьте факты перед использованием: бот не хранит историю между перезапусками.");
  return lines.filter(Boolean).join("\n");
}

export function createLumaBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command("start", async (context) => {
    const userId = context.from?.id;
    if (!userId || !isUserAllowed(userId)) {
      await context.reply(accessMessage(userId));
      return;
    }
    workspace(userId);
    await context.reply(
      [
        "Luma готова.",
        "",
        "Выберите действие кнопкой ниже или отправьте текст / до 10 скриншотов одним альбомом.",
        "Каждый результат даёт 3 варианта ответа: RU и EN.",
        "Ничего клиенту автоматически не отправляется.",
      ].join("\n"),
      { reply_markup: mainMenu() },
    );
  });

  bot.command("help", async (context) => {
    await context.reply("Аудит проверяет диалог, Ответ готовит 3 варианта, Фильтр ищет риски. «Карточка» сохраняет только подтверждённые факты до перезапуска бота.", { reply_markup: mainMenu() });
  });

  bot.command("forget", async (context) => {
    const userId = context.from?.id;
    if (userId) workspaces.delete(userId);
    await context.reply("Временные данные очищены. Постоянная история не ведётся.", { reply_markup: mainMenu() });
  });

  for (const [command, mode] of [["audit", "audit"], ["reply", "reply"], ["filter", "filter"]] as const) {
    bot.command(command, async (context) => {
      const text = context.match?.trim() ?? "";
      if (!text) {
        await setMode(context, mode);
        return;
      }
      await sendAudit(context, text, [], mode);
    });
  }

  bot.hears("🧠 Аудит", (context) => setMode(context, "audit"));
  bot.hears("✍️ Ответ", (context) => setMode(context, "reply"));
  bot.hears("🛡 Фильтр", (context) => setMode(context, "filter"));
  bot.hears("👤 Карточка", async (context) => {
    const userId = context.from?.id;
    if (!userId || !isUserAllowed(userId)) return context.reply(accessMessage(userId));
    await context.reply(cardText(workspace(userId)), { reply_markup: mainMenu() });
  });
  bot.hears("📚 Шаблоны", async (context) => {
    if (!isUserAllowed(context.from?.id)) return context.reply(accessMessage(context.from?.id));
    await context.reply("Выберите заготовку. В ответе будут русский и английский варианты:", { reply_markup: templatesKeyboard() });
  });
  bot.hears("🗓 План", async (context) => {
    if (!isUserAllowed(context.from?.id)) return context.reply(accessMessage(context.from?.id));
    await context.reply(["🗓 План спокойного диалога", "", ...WORKFLOW_STAGES].join("\n\n"), { reply_markup: mainMenu() });
  });
  bot.hears("📊 Статус", async (context) => {
    const userId = context.from?.id;
    if (!userId || !isUserAllowed(userId)) return context.reply(accessMessage(userId));
    const state = workspace(userId);
    await context.reply(["📊 Статус", `Режим: ${state.mode}`, `Фактов в карточке: ${state.facts.length}`, "Данные не записываются в базу."].join("\n"), { reply_markup: mainMenu() });
  });
  bot.hears("❓ Помощь", async (context) => {
    await context.reply("Отправьте текст или скриншоты. Выберите «Фильтр» перед отправкой сложного сообщения. Для полного сброса используйте /forget.", { reply_markup: mainMenu() });
  });

  bot.on("callback_query:data", async (context) => {
    const userId = context.from?.id;
    if (!isUserAllowed(userId)) {
      await context.answerCallbackQuery({ text: "Нет доступа" });
      return;
    }
    const [kind, id] = context.callbackQuery.data.split(":", 2);
    if (kind !== "template" || !id) {
      await context.answerCallbackQuery();
      return;
    }
    const template = findTemplate(id);
    if (!template) {
      await context.answerCallbackQuery({ text: "Шаблон не найден" });
      return;
    }
    await context.answerCallbackQuery({ text: "Готово" });
    await context.reply(`📚 ${template.title}\n\nRU: ${template.ru}\n\nEN: ${template.en}`, { reply_markup: mainMenu() });
  });

  bot.on("message:photo", async (context) => {
    const userId = context.from?.id;
    if (!isUserAllowed(userId)) {
      await context.reply(accessMessage(userId));
      return;
    }
    const photo = context.message.photo.at(-1);
    if (!photo) return;
    const groupId = context.message.media_group_id;
    const mode = currentMode(context);
    if (!groupId) {
      await sendAudit(context, context.message.caption ?? "", [photo.file_id], mode);
      return;
    }

    const existing = pendingAlbums.get(groupId);
    if (existing) {
      clearTimeout(existing.timer);
      if (!existing.fileIds.includes(photo.file_id)) existing.fileIds.push(photo.file_id);
      if (context.message.caption) existing.caption = context.message.caption;
      existing.timer = setTimeout(() => {
        pendingAlbums.delete(groupId);
        void sendAudit(existing.context, existing.caption, existing.fileIds, existing.mode);
      }, 1400);
      return;
    }

    const album: PendingAlbum = {
      context,
      fileIds: [photo.file_id],
      caption: context.message.caption ?? "",
      mode,
      timer: setTimeout(() => {
        pendingAlbums.delete(groupId);
        void sendAudit(context, context.message.caption ?? "", album.fileIds, album.mode);
      }, 1400),
    };
    pendingAlbums.set(groupId, album);
  });

  bot.on("message:text", async (context) => {
    if (context.message.text.startsWith("/")) return;
    await sendAudit(context, context.message.text, [], currentMode(context));
  });

  bot.catch(({ error }) => {
    const message = error instanceof Error ? error.message : "Bot error";
    console.error(`[bot] ${message}`);
  });

  return bot;
}
