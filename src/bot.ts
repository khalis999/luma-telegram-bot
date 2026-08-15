import { Api, Bot, Context, InlineKeyboard } from "grammy";

import { analyzeDialogue } from "./analyzer.js";
import { findTemplate, STARTER_TEMPLATES } from "./catalog.js";
import { config, hasAllowedUsers, isUserAllowed } from "./config.js";
import { formatAudit, splitTelegramMessage } from "./format.js";
import { translateText, type TranslationMode } from "./translator.js";
import type { MemberFact } from "./types.js";
import { formatUsageSummary } from "./usage.js";
import { transcribeVoice } from "./voice.js";

type AnalysisMode = "audit" | "reply" | "filter";

interface UserWorkspace {
  mode: AnalysisMode;
  facts: MemberFact[];
  stage?: string;
  translation?: TranslationMode;
  tags: string[];
  awaitingReminder: boolean;
  awaitingDuplicates: boolean;
  awaitingContentPlan: boolean;
  dailyReport: boolean;
  lastReportDate?: string;
  activity: {
    audits: number;
    translations: number;
    voices: number;
    reminders: number;
  };
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
    .text("👤 Мини-CRM", "action:card").text("🏷 Теги", "action:tags").row()
    .text("📚 Фразы", "action:templates").text("🔁 Антидубли", "action:duplicates").row()
    .text("🗓 Контент-план", "action:content-plan").text("🎙 Голос", "action:voice").row()
    .text("⏰ Напомнить", "action:reminder").text("📈 Отчёт", "action:report").row()
    .text("💰 Лимит", "action:budget").text("📊 Статус", "action:status").row()
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
  const next: UserWorkspace = {
    mode: "audit",
    facts: [],
    tags: [],
    awaitingReminder: false,
    awaitingDuplicates: false,
    awaitingContentPlan: false,
    dailyReport: false,
    activity: { audits: 0, translations: 0, voices: 0, reminders: 0 },
  };
  workspaces.set(userId, next);
  return next;
}

function currentMode(context: Context): AnalysisMode {
  const userId = context.from?.id;
  return userId ? workspace(userId).mode : "audit";
}

function recordActivity(userId: number | undefined, action: keyof UserWorkspace["activity"]): void {
  if (!userId) return;
  workspace(userId).activity[action] += 1;
}

function modeCopy(mode: AnalysisMode): string {
  if (mode === "reply") return "Режим «Ответ»: пришлите текст или скриншоты — подготовлю 3 варианта на русском и английском.";
  if (mode === "filter") return "Режим «Фильтр»: пришлите текст — проверю его перед отправкой и предложу безопасную замену.";
  return "Режим «Аудит»: пришлите текст или до 10 скриншотов одним альбомом.";
}

async function setMode(context: Context, mode: AnalysisMode): Promise<void> {
  const userId = context.from?.id;
  if (!userId) return;
  const state = workspace(userId);
  state.mode = mode;
  state.awaitingReminder = false;
  state.awaitingDuplicates = false;
  state.awaitingContentPlan = false;
  delete state.translation;
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

async function downloadTelegramFile(api: Api, fileId: string, maxBytes: number, label: string): Promise<Buffer> {
  const file = await api.getFile(fileId);
  if (!file.file_path) throw new Error("Сервис не вернул файл");
  const response = await fetch(`https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`);
  if (!response.ok) throw new Error(`Не удалось загрузить ${label}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error(`${label} слишком большой`);
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
    const images = await Promise.all(fileIds.map((fileId) => downloadTelegramFile(context.api, fileId, config.maxImageBytes, "скриншот")));
    const result = await analyzeDialogue({ text, images, mode });
    saveFacts(userId, result.memberFacts, result.stage);
    recordActivity(userId, "audits");
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
    .text("✨ Natural English", "translate:natural-en").text("🪄 Умный", "translate:smart").row()
    .text("‹ В меню", "action:home");
}

function translationCopy(mode: TranslationMode): string {
  if (mode === "ru-en") return "Режим «RU → EN». Пришлите русский текст — верну естественный английский вариант.";
  if (mode === "en-ru") return "Режим «EN → RU». Пришлите английский текст — верну понятный русский вариант.";
  if (mode === "smart") return "Режим «Умный перевод». Пришлите текст на русском или английском — сам определю язык и переведу на другой.";
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
    recordActivity(userId, "translations");
    const prefix = result.safe ? "🌐" : "🛡";
    await context.reply(`${prefix} ${result.label}\n\n${result.text}`, { reply_markup: homeKeyboard() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось выполнить перевод";
    await context.reply(message, { reply_markup: homeKeyboard() });
  }
}

function reportKeyboard(enabled: boolean): InlineKeyboard {
  return new InlineKeyboard()
    .text(enabled ? "✅ Ежедневный отчёт включён" : "Включить ежедневный отчёт", enabled ? "action:report-off" : "action:report-on")
    .row()
    .text("‹ В меню", "action:home");
}

function dailyReportText(state: UserWorkspace): string {
  return [
    "📈 Luma — отчёт за сегодня",
    `Аудиты: ${state.activity.audits} · Переводы: ${state.activity.translations} · Голосовые: ${state.activity.voices}`,
    `Напоминания: ${state.activity.reminders}`,
    "",
    formatUsageSummary(),
    "",
    "Отчёт хранится только в памяти работающего бота и не является данными биллинга OpenAI.",
  ].join("\n");
}

function scheduleReminder(context: Context, minutes: number, note: string): void {
  const userId = context.from?.id;
  if (!userId) return;
  const timer = setTimeout(() => {
    void context.api.sendMessage(userId, `⏰ Напоминание\n\n${note}`, { reply_markup: homeKeyboard() })
      .catch((error: unknown) => console.error("[luma] reminder error:", error));
  }, minutes * 60_000);
  timer.unref();
  recordActivity(userId, "reminders");
}

async function addReminderFromText(context: Context, raw: string): Promise<boolean> {
  const match = raw.trim().match(/^(\d{1,4})\s+([\s\S]{1,600})$/);
  if (!match) return false;
  const minutes = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 1440) {
    await context.reply("Укажите от 1 до 1440 минут. Например: 30 проверить ответ", { reply_markup: homeKeyboard() });
    return true;
  }
  const note = (match[2] ?? "").trim();
  scheduleReminder(context, minutes, note);
  await context.reply(`⏰ Готово. Напомню через ${minutes} мин.: ${note}`, { reply_markup: homeKeyboard() });
  return true;
}

async function sendVoiceText(context: Context, fileId: string, filename: string): Promise<void> {
  const userId = context.from?.id;
  if (!isUserAllowed(userId)) {
    await context.reply(accessMessage(userId));
    return;
  }

  try {
    await context.replyWithChatAction("typing");
    const audio = await downloadTelegramFile(context.api, fileId, config.maxVoiceBytes, "голосовое");
    const text = await transcribeVoice(audio, filename);
    recordActivity(userId, "voices");
    if (!text) {
      await context.reply("🛡 В голосовом обнаружена тема, которую нельзя воспроизводить. Текст не показан.", { reply_markup: homeKeyboard() });
      return;
    }
    await context.reply(`🎙 Текст голосового\n\n${text}`, { reply_markup: homeKeyboard() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось распознать голосовое";
    await context.reply(message, { reply_markup: homeKeyboard() });
  }
}

function reportTime(): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.reportTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>;
  return {
    date: `${values.year ?? ""}-${values.month ?? ""}-${values.day ?? ""}`,
    hour: Number.parseInt(values.hour ?? "", 10),
  };
}

function scheduleDailyReports(bot: Bot): void {
  const sendDueReports = () => {
    let now: { date: string; hour: number };
    try {
      now = reportTime();
    } catch {
      now = { date: new Date().toISOString().slice(0, 10), hour: new Date().getUTCHours() };
    }
    if (now.hour !== config.dailyReportHour) return;
    for (const [userId, state] of workspaces) {
      if (!state.dailyReport || state.lastReportDate === now.date) continue;
      void bot.api.sendMessage(userId, dailyReportText(state), { reply_markup: homeKeyboard() })
        .then(() => { state.lastReportDate = now.date; })
        .catch((error: unknown) => console.error("[luma] daily report error:", error));
    }
  };
  const timer = setInterval(sendDueReports, 60_000);
  timer.unref();
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

function duplicateReport(text: string): string {
  const fragments = text
    .split(/\n+|(?<=[.!?])\s+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8)
    .slice(0, 300);
  const seen = new Map<string, number[]>();

  fragments.forEach((fragment, index) => {
    const key = fragment
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "");
    if (key.length < 8) return;
    const items = seen.get(key) ?? [];
    items.push(index + 1);
    seen.set(key, items);
  });

  const duplicates = [...seen.values()].filter((items) => items.length > 1);
  if (duplicates.length === 0) {
    return "🔁 Антидубли\n\nПовторов в сообщении не найдено. Текст можно отправлять после обычной проверки фильтром.";
  }

  const lines = duplicates.slice(0, 8).map((items, index) => `• Повтор ${index + 1}: фразы ${items.join(", ")}`);
  return ["🔁 Антидубли", "", `Найдено повторов: ${duplicates.length}. Исходные фразы не показываю, чтобы не воспроизводить рискованный текст.`, "", ...lines, "", "Уберите дубли и проверьте финальную версию через «Проверить текст»."].join("\n");
}

function contentPlanText(): string {
  return [
    "🗓 Контент-план на 7 дней",
    "",
    "1. Лёгкий лайф-кадр: настроение дня + один естественный вопрос.",
    "2. Интерес или хобби: короткая история, фото или видео процесса.",
    "3. Закулисье: как готовится образ, идея или рабочее место.",
    "4. Опрос: предложите аудитории выбрать тему следующего поста.",
    "5. Личное достижение: тренировка, учёба, маленькая цель дня.",
    "6. Подборка: 2–3 безопасных кадра или мысли недели.",
    "7. Итог недели: благодарность и вопрос, что аудитории понравилось больше.",
    "",
    "Перед публикацией проверьте описание кнопкой «Проверить текст». Не включайте личные данные, внешние платежи или предложения вне платформы.",
  ].join("\n");
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
  scheduleDailyReports(bot);

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
    await context.reply("Аудит проверяет диалог, «Ответ» готовит 3 варианта, «Фильтр» ищет риски. Есть перевод, голос-в-текст, Mini-CRM, быстрые фразы, антидубли, контент-план, напоминания, ежедневный отчёт и лимит расходов. Напоминание: /remind 30 текст. Данные не отправляются клиентам автоматически.", { reply_markup: homeKeyboard() });
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

  bot.command("remind", async (context) => {
    const userId = context.from?.id;
    if (!isUserAllowed(userId)) {
      await context.reply(accessMessage(userId));
      return;
    }
    const text = context.match?.trim() ?? "";
    if (!await addReminderFromText(context, text)) {
      await context.reply("⏰ Формат: /remind минуты текст\n\nНапример: /remind 30 проверить ответ", { reply_markup: homeKeyboard() });
    }
  });

  bot.command("report", async (context) => {
    const userId = context.from?.id;
    if (!isUserAllowed(userId)) {
      await context.reply(accessMessage(userId));
      return;
    }
    const state = workspace(userId!);
    await context.reply(dailyReportText(state), { reply_markup: reportKeyboard(state.dailyReport) });
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
      const state = workspace(userId!);
      if (id !== "translate") delete state.translation;
      if (id !== "reminder") state.awaitingReminder = false;
      if (id !== "duplicates") state.awaitingDuplicates = false;
      if (id !== "content-plan") state.awaitingContentPlan = false;
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
      if (id === "duplicates") {
        state.awaitingDuplicates = true;
        await context.reply("🔁 Пришлите текст. Я отмечу повторяющиеся фразы по их номерам и не буду воспроизводить рискованный фрагмент.", { reply_markup: homeKeyboard() });
        return;
      }
      if (id === "content-plan") {
        state.awaitingContentPlan = true;
        await context.reply("🗓 Пришлите тему или цель недели — я дам компактный план на 7 дней. Не указывайте личные данные.", { reply_markup: homeKeyboard() });
        return;
      }
      if (id === "translate") {
        await context.reply("🌐 Выберите направление перевода:", { reply_markup: translationKeyboard() });
        return;
      }
      if (id === "voice") {
        await context.reply("🎙 Отправьте голосовое до 20 МБ — я верну текст. При обнаружении запрещённой темы текст не показывается.", { reply_markup: homeKeyboard() });
        return;
      }
      if (id === "reminder") {
        workspace(userId!).awaitingReminder = true;
        await context.reply("⏰ Напишите: минуты и текст напоминания.\n\nНапример: 30 проверить ответ", { reply_markup: homeKeyboard() });
        return;
      }
      if (id === "report") {
        const state = workspace(userId!);
        await context.reply(dailyReportText(state), { reply_markup: reportKeyboard(state.dailyReport) });
        return;
      }
      if (id === "report-on" || id === "report-off") {
        const state = workspace(userId!);
        state.dailyReport = id === "report-on";
        await context.reply(
          state.dailyReport
            ? `✅ Ежедневный отчёт включён. Он придёт в ${String(config.dailyReportHour).padStart(2, "0")}:00 (${config.reportTimeZone}).`
            : "Ежедневный отчёт выключен.",
          { reply_markup: reportKeyboard(state.dailyReport) },
        );
        return;
      }
      if (id === "budget") {
        await context.reply(`💰 Лимит расходов\n\n${formatUsageSummary()}`, { reply_markup: homeKeyboard() });
        return;
      }
      if (id === "status") {
        const state = workspace(userId!);
        await context.reply(["📊 Статус", `Режим: ${state.mode}`, `Фактов в карточке: ${state.facts.length}`, `Ежедневный отчёт: ${state.dailyReport ? "включён" : "выключен"}`, "Данные не записываются в базу."].join("\n"), { reply_markup: homeKeyboard() });
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
    if (kind === "translate" && (id === "ru-en" || id === "en-ru" || id === "natural-en" || id === "smart")) {
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

  bot.on("message:voice", async (context) => {
    await sendVoiceText(context, context.message.voice.file_id, "voice.ogg");
  });

  bot.on("message:audio", async (context) => {
    const filename = context.message.audio.file_name?.trim() || "audio.mp3";
    await sendVoiceText(context, context.message.audio.file_id, filename);
  });

  bot.on("message:text", async (context) => {
    if (context.message.text.startsWith("/")) return;
    const state = context.from?.id ? workspace(context.from.id) : undefined;
    if (state?.awaitingReminder) {
      state.awaitingReminder = false;
      if (await addReminderFromText(context, context.message.text)) return;
      await context.reply("Не получилось прочитать напоминание. Формат: 30 проверить ответ", { reply_markup: homeKeyboard() });
      return;
    }
    if (state?.awaitingDuplicates) {
      state.awaitingDuplicates = false;
      await context.reply(duplicateReport(context.message.text), { reply_markup: homeKeyboard() });
      return;
    }
    if (state?.awaitingContentPlan) {
      state.awaitingContentPlan = false;
      await context.reply(contentPlanText(), { reply_markup: homeKeyboard() });
      return;
    }
    const translation = state?.translation;
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
