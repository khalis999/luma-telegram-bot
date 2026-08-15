import OpenAI from "openai";

import { config } from "./config.js";
import { scanProhibited } from "./filter.js";
import { reserveUsage } from "./usage.js";

export type TranslationMode = "ru-en" | "en-ru" | "natural-en" | "smart";

export interface TranslationResult {
  label: string;
  text: string;
  safe: boolean;
}

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!config.openAiApiKey) throw new Error("missing-key");
  client ??= new OpenAI({ apiKey: config.openAiApiKey });
  return client;
}

function translationLabel(mode: TranslationMode): string {
  if (mode === "ru-en") return "RU → EN";
  if (mode === "en-ru") return "EN → RU";
  if (mode === "smart") return "Smart translate";
  return "Natural English";
}

function blockedResult(mode: TranslationMode): TranslationResult {
  const text = mode === "en-ru"
    ? "В тексте обнаружена тема, которую нельзя воспроизводить. Используйте нейтральную безопасную формулировку."
    : "This text contains a topic that must not be reproduced. Please use a neutral, safe alternative.";
  return { label: translationLabel(mode), text, safe: false };
}

function friendlyTranslatorError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("missing-key") || message.includes("incorrect api key") || message.includes("invalid api key")) {
    return "Переводчик не подключён: добавьте корректный OPENAI_API_KEY в Secrets Replit и перезапустите приложение.";
  }

  if (message.includes("quota") || message.includes("billing") || message.includes("credit") || message.includes("insufficient")) {
    return "Переводчик временно недоступен: для OpenAI API нужен доступный лимит или активный биллинг проекта.";
  }

  if (message.includes("model") && (message.includes("not found") || message.includes("does not exist") || message.includes("access"))) {
    return "Переводчик временно недоступен: выбранная AI-модель недоступна для этого API-ключа.";
  }

  return "Переводчик временно недоступен. Попробуйте ещё раз через минуту.";
}

export async function translateText(text: string, mode: TranslationMode): Promise<TranslationResult> {
  const source = text.trim();
  if (!source) throw new Error("Добавьте текст для перевода");
  if (scanProhibited(source).length > 0) return blockedResult(mode);

  const target = mode === "ru-en"
    ? "Translate Russian to natural English."
    : mode === "en-ru"
      ? "Translate English to natural Russian."
      : mode === "smart"
        ? "Detect whether the input is Russian or English, then translate it into the other language. Make the result concise, natural, and conversational."
        : "Rewrite the text in concise, natural, conversational English. Preserve the meaning, but do not translate word-for-word.";

  const reservation = reserveUsage("translation");
  try {
    const response = await getClient().responses.create({
      model: config.openAiModel,
      instructions: [
        "You are a safe translation assistant for adult-creator customer support between consenting adults.",
        "Return only the translated or rewritten text, with no title, commentary, quotation marks, or extra options.",
        "Keep it non-explicit, respectful, and professional.",
        "Never reproduce prohibited terms or provide an alternative that bypasses platform rules.",
      ].join(" "),
      input: `${target}\n\nText:\n${source}`,
      reasoning: { effort: "low" },
      max_output_tokens: 700,
    });
    reservation.settleText(response.usage);
    const translated = response.output_text.trim();
    if (!translated || scanProhibited(translated).length > 0) return blockedResult(mode);
    return { label: translationLabel(mode), text: translated, safe: true };
  } catch (error) {
    reservation.cancel();
    console.error("[luma] translator error:", error);
    throw new Error(friendlyTranslatorError(error));
  }
}
