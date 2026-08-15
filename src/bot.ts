import { Api, Bot, Context, InlineKeyboard } from "grammy";

import { analyzeDialogue } from "./analyzer.js";
import { findTemplate, STARTER_TEMPLATES, WORKFLOW_STAGES } from "./catalog.js";
import { config, hasAllowedUsers, isUserAllowed } from "./config.js";
import { formatAudit, splitTelegramMessage } from "./format.js";
import { translateText, type TranslationMode } from "./translator.js";
import type { MemberFact } from "./types.js";

type AnalysisMode = "audit" | "reply" | "filter";

interface UserWorkspace {
  mode: AnalysisMode;
  facts: MemberFact[];
  stage?: string;
  translation?: TranslationMode;
  tags: string[];
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

function homeKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("🧠 Аудит", "action:audit").text("✍️ Ответ", "action:reply").row()
    .text("🛡 Проверить текст", "action:filter").text("🌐 Перевод", "action:translate").row()
    .text("👤 Карточка", "action:card").text("🏷 Теги", "action:tags").row()
    .text("📚 Шаблоны", "action:templates").text("🗓 План", "action:plan").row()
    .text("📊 Статус", "action:status").row()
    .text("❓ Как пользоваться", "action:help");

  if (config.publicBaseUrl) keyboard.row().webApp("✦ Открыть Luma", config.publicBaseUrl);
  return keyboard;
}

function accessMessage(userId: number | undefined): string {
  if (!userId) return "Не удалось определить ваш ID.";
  if (!hasAllowedUsers()) return `Бот пока закрыт. Ваш ID: ${userId}. Добавьте его в список разрешённых при настройке.`;
  return "У вас нет доступа к этому приватному боту.";
}

function workspace(userId: number): UserWorkspace {
  const existing = workspaces.get(userId);
  if (existing) return existing;
  const next: UserWorkspace = { mode: "audit", facts: [], tags: [] };
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
  delete workspace(userId).translation;
  await context.reply(modeCopy(mode), { reply_markup: homeKeyboard() });
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
    await context.reply("Готово. Выберите следующее действие:", { reply_markup: homeKeyboard() });

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
  return keyboard.text("‹ В меню", "action:home");
}

function translationKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🇷🇺 → 🇬🇧", "translate:ru-en").text("🇬🇧 → 🇷🇺", "translate:en-ru").row()
    .text("✨ Natural English", "translate:natural-en").row()
    .text("‹ В меню", "action:home");
}

function translationCopy(mode: TranslationMode): string {
  if (mode === "ru-en") return "Режим «RU → EN». Пришлите русский текст — верну естественный английский вариант.";
  if (mode === "en-ru") return "Режим «EN → RU». Пришлите английский текст — верну понятный русский вариант.";
  return "Режим «Natural English». Пришлите черновик — сделаю короткий и естественный английский.";
}

async function sendTranslation(context: Context, text: string, mode: TranslationMode): Promise<void> {
  const userId = context.from?.id;
  if (!isUserAllowed(userId)) {
    await context.reply(accessMessage(userId));
    return;
  }
  try {
    await context.replyWithChatAction("typing");
    const result = await translateText(text, mode);
    const prefix = result.safe ? "🌐" : "🛡";
    await context.reply(`${prefix} ${result.label}\n\n${result.text}`, { reply_markup: homeKeyboard() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось выполнить перевод";
    await context.reply(message, { reply_markup: homeKeyboard() });
  }
}

function cardText(state: UserWorkspace): string {
  if (state.facts.length === 0) {
    return "Карточка пока пуста. После аудита сюда попадут только подтверждённые, несенситивные факты из диалога. Она хранится только пока работает бот.";
  }
  const lines = ["👤 Карточка клиента", state.stage ? `Этап: ${state.stage}` : "", state.tags.length ? `Теги: ${state.tags.join(", ")}` : ""];
  state.facts.forEach((fact) => lines.push(`• ${fact.field}: ${fact.value}`));
  lines.push("", "Проверьте факты перед использованием: бот не хранит историю между перезапусками.");
  return lines.filter(Boolean).join("\n");
}

function tagsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🆕 Новый", "tag:новый").text("⭐ Постоянный", "tag:постоянный").row()
    .text("🔥 Приоритет", "tag:приоритет").text("🔎 Проверить", "tag:проверить").row()
    .text("Очистить теги", "tag:clear").row()
    .text("‹ В меню", "action:home");
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
    await context.reply("Обновляю интерфейс…", { reply_markup: { remove_keyboard: true } });
    await context.reply(
      [
        "✦ LUMA",
        "PRIVATE COPILOT",
        "",
        "Аудит диалогов · безопасные ответы · RU + EN",
        "",
        "Выберите действие ниже или отправьте текст / до 10 скриншотов одним альбомом.",
        "Ответы не отправляются автоматически.",
      ].join("\n"),
      { reply_markup: homeKeyboard() },
    );
  });

  bot.command("help", async (context) => {
    await context.reply("Аудит проверяет диалог, Ответ готовит 3 варианта, Фильтр ищет риски. «Карточка» сохраняет только подтверждённые факты до перезапуска бота.", { reply_markup: homeKeyboard() });
  });

  bot.command("forget", async (context) => {
    const userId = context.from?.id;
    if (userId) workspaces.delete(userId);
    await context.reply("Временные данные очищены. Постоянная история не ведётся.", { reply_markup: homeKeyboard() });
  });

  bot.command("translate", async (context) => {
    const userId = context.from?.id;
    if (!isUserAllowed(userId)) {
      await context.reply(accessMessage(userId));
      return;
    }
    const text = context.match?.trim() ?? "";
    if (text) {
      await sendTranslation(context, text, "ru-en");
      return;
    }
    await context.reply("🌐 Выберите направление перевода:", { reply_markup: translationKeyboard() });
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

  bot.on("callback_query:data", async (context) => {
    const userId = context.from?.id;
    if (!isUserAllowed(userId)) {
      await context.answerCallbackQuery({ text: "Нет доступа" });
      return;
    }
    const [kind, id] = context.callbackQuery.data.split(":", 2);
    if (kind === "action" && id) {
      await context.answerCallbackQuery();
      if (id !== "translate") delete workspace(userId!).translation;
      if (id === "audit" || id === "reply" || id === "filter") {
        await setMode(context, id);
        return;
      }
      if (id === "card") {
        await context.reply(cardText(workspace(userId!)), { reply_markup: homeKeyboard() });
        return;
      }
      if (id === "tags") {
        await context.reply("🏷 Быстрые теги карточки:", { reply_markup: tagsKeyboard() });
        return;
      }
      if (id === "templates") {
        await context.reply("Выберите заготовку — я покажу готовый вариант на русском и английском:", { reply_markup: templatesKeyboard() });
        return;
      }
      if (id === "translate") {
        await context.reply("🌐 Выберите направление перевода:", { reply_markup: translationKeyboard() });
        return;
      }
      if (id === "plan") {
        await context.reply(["🗓 План спокойного диалога", "", ...WORKFLOW_STAGES].join("\n\n"), { reply_markup: homeKeyboard() });
        return;
      }
      if (id === "status") {
        const state = workspace(userId!);
        await context.reply(["📊 Статус", `Режим: ${state.mode}`, `Фактов в карточке: ${state.facts.length}`, "Данные не записываются в базу."].join("\n"), { reply_markup: homeKeyboard() });
        return;
      }
      if (id === "help") {
        await context.reply("Выберите режим, затем отправьте текст или скриншоты. Фильтр используйте перед отправкой сложного сообщения. Для полного сброса — /forget.", { reply_markup: homeKeyboard() });
        return;
      }
      if (id === "home") {
        await context.reply("✦ LUMA\nВыберите действие:", { reply_markup: homeKeyboard() });
        return;
      }
      return;
    }
    if (kind === "tag" && id) {
      const state = workspace(userId!);
      if (id === "clear") state.tags = [];
      else if (state.tags.includes(id)) state.tags = state.tags.filter((tag) => tag !== id);
      else state.tags = [...state.tags, id].slice(0, 6);
      await context.answerCallbackQuery({ text: id === "clear" ? "Теги очищены" : "Тег обновлён" });
      await context.reply(`🏷 Теги: ${state.tags.length ? state.tags.join(", ") : "нет"}`, { reply_markup: tagsKeyboard() });
      return;
    }
    if (kind === "translate" && (id === "ru-en" || id === "en-ru" || id === "natural-en")) {
      workspace(userId!).translation = id;
      await context.answerCallbackQuery({ text: "Режим перевода выбран" });
      await context.reply(translationCopy(id), { reply_markup: homeKeyboard() });
      return;
    }
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
    await context.reply(`📚 ${template.title}\n\nRU: ${template.ru}\n\nEN: ${template.en}`, { reply_markup: homeKeyboard() });
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
    const translation = context.from?.id ? workspace(context.from.id).translation : undefined;
    if (translation) {
      await sendTranslation(context, context.message.text, translation);
      return;
    }
    await sendAudit(context, context.message.text, [], currentMode(context));
  });

  bot.catch(({ error }) => {
    const message = error instanceof Error ? error.message : "Bot error";
    console.error(`[bot] ${message}`);
  });

  return bot;
}
