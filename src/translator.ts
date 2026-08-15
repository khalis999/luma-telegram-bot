import OpenAI from "openai";

import { config } from "./config.js";
import { scanProhibited } from "./filter.js";

export type TranslationMode = "ru-en" | "en-ru" | "natural-en";

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
  return "Natural English";
}

function blockedResult(mode: TranslationMode): TranslationResult {
  const text = mode === "en-ru"
    ? "В тексте обнаружена тема, которую нельзя воспроизводить. Используйте нейтральную безопасную формулировку."
    : "This text contains a topic that must not be reproduced. Please use a neutral, safe alternative.";
  return { label: translationLabel(mode), text, safe: false };
}

export async function translateText(text: string, mode: TranslationMode): Promise<TranslationResult> {
  const source = text.trim();
  if (!source) throw new Error("Добавьте текст для перевода");
  if (scanProhibited(source).length > 0) return blockedResult(mode);

  const target = mode === "ru-en"
    ? "Translate Russian to natural English."
    : mode === "en-ru"
      ? "Translate English to natural Russian."
      : "Rewrite the text in concise, natural, conversational English. Preserve the meaning, but do not translate word-for-word.";

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
    const translated = response.output_text.trim();
    if (!translated || scanProhibited(translated).length > 0) return blockedResult(mode);
    return { label: translationLabel(mode), text: translated, safe: true };
  } catch {
    throw new Error("Переводчик временно недоступен. Проверьте подключение AI API.");
  }
}
