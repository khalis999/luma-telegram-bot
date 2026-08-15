import OpenAI, { toFile } from "openai";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { config } from "./config.js";
import { scanProhibited } from "./filter.js";
import { reserveUsage } from "./usage.js";

let client: OpenAI | undefined;

interface PreparedAudio {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

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
  if (message.includes("convert")) return "Не удалось подготовить голосовое. Отправьте запись ещё раз или пришлите её как аудиофайл MP3.";
  return "Не удалось распознать голосовое. Попробуйте отправить запись ещё раз.";
}

function contentTypeFor(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".m4a" || extension === ".mp4") return "audio/mp4";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".webm") return "audio/webm";
  return "application/octet-stream";
}

function runFfmpeg(input: string, output: string): Promise<void> {
  const ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";

  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", output], { stdio: "ignore" });
    process.once("error", () => reject(new Error("voice-convert-failed")));
    process.once("close", (code) => code === 0 ? resolve() : reject(new Error("voice-convert-failed")));
  });
}

async function prepareAudio(buffer: Buffer, filename: string): Promise<PreparedAudio> {
  if (path.extname(filename).toLowerCase() !== ".ogg") {
    return { buffer, filename, contentType: contentTypeFor(filename) };
  }

  const directory = await mkdtemp(path.join(tmpdir(), "luma-voice-"));
  const source = path.join(directory, "voice.ogg");
  const target = path.join(directory, "voice.mp3");
  try {
    await writeFile(source, buffer);
    await runFfmpeg(source, target);
    return { buffer: await readFile(target), filename: "voice.mp3", contentType: "audio/mpeg" };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function transcribeVoice(buffer: Buffer, filename = "voice.ogg"): Promise<string | undefined> {
  if (buffer.byteLength === 0) throw new Error("Голосовое пустое");
  if (buffer.byteLength > config.maxVoiceBytes) throw new Error("Голосовое слишком большое. Максимум 20 МБ.");

  const reservation = reserveUsage("voice");
  try {
    const prepared = await prepareAudio(buffer, filename);
    const file = await toFile(prepared.buffer, prepared.filename, { type: prepared.contentType });
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
