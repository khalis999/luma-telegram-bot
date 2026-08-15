import OpenAI, { toFile } from "openai";

import { config } from "./config.js";
import { scanProhibited } from "./filter.js";
import { reserveUsage } from "./usage.js";

let client: OpenAI | undefined;

function openAiClient(): OpenAI {
  if (!config.openAiApiKey) throw new Error("Голосовой ввод не подключён: добавьте OPENAI_API_KEY в Secrets Replit.");
  client ??= new OpenAI({ apiKey: config.openAiApiKey });
  return client;
}

function friendlyVoiceError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("quota") || message.includes("billing") || message.includes("credit") || message.includes("insufficient")) {
    return "Голосовой ввод временно недоступен: для OpenAI API нужен доступный лимит или активный биллинг.";
  }
  if (message.includes("too large") || message.includes("maximum")) return "Голосовое слишком большое. Отправьте запись до 20 МБ.";
  return "Не удалось распознать голосовое. Попробуйте отправить запись ещё раз.";
}

export async function transcribeVoice(buffer: Buffer, filename = "voice.ogg"): Promise<string | undefined> {
  if (buffer.byteLength === 0) throw new Error("Голосовое пустое");
  if (buffer.byteLength > config.maxVoiceBytes) throw new Error("Голосовое слишком большое. Максимум 20 МБ.");

  const reservation = reserveUsage("voice");
  try {
    const file = await toFile(buffer, filename);
    const transcription = await openAiClient().audio.transcriptions.create({
      file,
      model: config.transcriptionModel,
      response_format: "json",
    });
    reservation.settleText(transcription.usage);
    const text = transcription.text.trim();
    return text && scanProhibited(text).length === 0 ? text : undefined;
  } catch (error) {
    reservation.cancel();
    console.error("[luma] voice error:", error);
    throw new Error(friendlyVoiceError(error));
  }
}
