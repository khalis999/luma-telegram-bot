import OpenAI from "openai";
import sharp from "sharp";

import { config } from "./config.js";
import { enforceOutputSafety, makeFallbackResult, scanProhibited } from "./filter.js";
import { SYSTEM_INSTRUCTIONS } from "./knowledge.js";
import { reserveUsage } from "./usage.js";
import type { AnalyzeInput, AuditResult } from "./types.js";

const AUDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "score",
    "stage",
    "summary",
    "strengths",
    "issues",
    "missingContext",
    "memberFacts",
    "replyVariants",
    "safeToSend",
  ],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    stage: { type: "string" },
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" }, maxItems: 6 },
    issues: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "category", "explanation", "howToFix"],
        properties: {
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          category: { type: "string" },
          explanation: { type: "string" },
          howToFix: { type: "string" },
        },
      },
    },
    missingContext: { type: "array", items: { type: "string" }, maxItems: 8 },
    memberFacts: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "value", "confidence"],
        properties: {
          field: { type: "string" },
          value: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
    replyVariants: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tone", "labelRu", "ru", "en"],
        properties: {
          tone: { type: "string", enum: ["warm", "playful", "firm"] },
          labelRu: { type: "string" },
          ru: { type: "string" },
          en: { type: "string" },
        },
      },
    },
    safeToSend: { type: "boolean" },
  },
} as const;

let client: OpenAI | undefined;

function friendlyAnalyzerError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("quota") || message.includes("billing") || message.includes("credit")) {
    return "AI-модуль временно недоступен из-за лимита проекта.";
  }
  if (message.includes("401") || message.includes("api key")) {
    return "AI-модуль ещё не подключён к проекту.";
  }
  return "AI-модуль временно недоступен. Использован безопасный резервный анализ.";
}

function openAiClient(): OpenAI {
  if (!config.openAiApiKey) throw new Error("OpenAI API key is not configured");
  client ??= new OpenAI({ apiKey: config.openAiApiKey });
  return client;
}

export async function prepareImage(buffer: Buffer): Promise<Buffer> {
  if (buffer.byteLength > config.maxImageBytes) {
    throw new Error("Изображение слишком большое");
  }

  return sharp(buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

function userPrompt(input: AnalyzeInput, riskCategories: string[]): string {
  const mode = input.mode ?? "audit";
  const text = input.text.trim() || "Диалог находится на приложенных скриншотах.";
  const riskNote = riskCategories.length > 0
    ? `The deterministic pre-filter found these neutral risk categories: ${riskCategories.join(", ")}. Do not quote the triggering text.`
    : "The deterministic pre-filter did not find a known prohibited category in the pasted text.";

  return [
    `Requested mode: ${mode}.`,
    riskNote,
    "Analyze all screenshots in upload order as one continuous conversation.",
    "Return only the structured audit. Do not reproduce prohibited phrases from the source.",
    "Conversation text:",
    text,
  ].join("\n\n");
}

export async function analyzeDialogue(input: AnalyzeInput): Promise<AuditResult> {
  if (!input.text.trim() && input.images.length === 0) {
    throw new Error("Добавьте текст или хотя бы один скриншот");
  }
  if (input.images.length > config.maxImages) {
    throw new Error(`Можно добавить не больше ${config.maxImages} скриншотов`);
  }

  const inputRisks = scanProhibited(input.text);
  let reservation: ReturnType<typeof reserveUsage> | undefined;

  try {
    reservation = reserveUsage("audit");
    const preparedImages = await Promise.all(input.images.map(prepareImage));
    const content: Array<Record<string, unknown>> = [
      { type: "input_text", text: userPrompt(input, inputRisks.map((risk) => risk.category)) },
      ...preparedImages.map((image) => ({
        type: "input_image",
        image_url: `data:image/jpeg;base64,${image.toString("base64")}`,
        detail: "high",
      })),
    ];

    const response = await openAiClient().responses.create({
      model: config.openAiModel,
      instructions: SYSTEM_INSTRUCTIONS,
      input: [{ role: "user", content }] as never,
      reasoning: { effort: "low" },
      max_output_tokens: 4000,
      text: {
        format: {
          type: "json_schema",
          name: "luma_dialogue_audit",
          description: "A safe structured audit of a customer-support dialogue",
          strict: true,
          schema: AUDIT_SCHEMA,
        },
      },
    });
    reservation.settleText(response.usage);

    if (!response.output_text) throw new Error("Модель не вернула результат");
    const parsed = JSON.parse(response.output_text) as AuditResult;
    return enforceOutputSafety(parsed, inputRisks);
  } catch (error) {
    reservation?.cancel();
    return makeFallbackResult(inputRisks, friendlyAnalyzerError(error));
  }
}
