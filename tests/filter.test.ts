import { describe, expect, it } from "vitest";

import { enforceOutputSafety, normalizeForRiskScan, scanProhibited } from "../src/filter.js";
import type { AuditResult } from "../src/types.js";

const safeResult: AuditResult = {
  score: 91,
  stage: "знакомство",
  summary: "Диалог дружелюбный и естественный.",
  strengths: ["Есть встречный вопрос"],
  issues: [],
  missingContext: [],
  memberFacts: [],
  replyVariants: [
    { tone: "warm", labelRu: "Тёплый", ru: "Спасибо! Как прошёл твой день?", en: "Thank you! How was your day?" },
    { tone: "playful", labelRu: "Игривый", ru: "Вот это настроение! Что тебя так порадовало?", en: "That is quite a mood! What made you so happy?" },
    { tone: "firm", labelRu: "Твёрдый", ru: "Давай общаться уважительно. Расскажешь о себе?", en: "Let’s keep it respectful. Would you tell me about yourself?" },
  ],
  safeToSend: true,
};

describe("risk filter", () => {
  it("normalizes separators and lookalike characters", () => {
    expect(normalizeForRiskScan("m.e.e.t")).toBe("meet");
    expect(normalizeForRiskScan("p@ypal")).toBe("paypal");
  });

  it("detects obfuscated prohibited categories without returning source terms", () => {
    const hits = scanProhibited("m.e.e.t and p@ypal");
    expect(hits.map((hit) => hit.category)).toEqual(expect.arrayContaining(["personal-contact-risk", "off-platform-payment-risk"]));
  });

  it("leaves safe reply variants intact", () => {
    const checked = enforceOutputSafety(safeResult, []);
    expect(checked.safeToSend).toBe(true);
    expect(checked.replyVariants[0]?.ru).toBe(safeResult.replyVariants[0]?.ru);
  });

  it("replaces risky output before it is shown", () => {
    const risky: AuditResult = structuredClone(safeResult);
    risky.replyVariants[0] = { ...risky.replyVariants[0]!, en: "Can we m.e.e.t?" };
    const checked = enforceOutputSafety(risky, []);
    expect(checked.safeToSend).toBe(false);
    expect(scanProhibited(checked.replyVariants.map((item) => `${item.ru} ${item.en}`).join(" "))).toEqual([]);
  });
});
