import { PROHIBITED_TERMS } from "./knowledge.js";
import type { AuditIssue, AuditResult, ReplyVariant, RiskHit, Severity } from "./types.js";

const LOOKALIKE_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  "$": "s",
  "а": "a",
  "е": "e",
  "ё": "e",
  "о": "o",
  "р": "p",
  "с": "c",
  "у": "y",
  "х": "x",
  "к": "k",
  "м": "m",
  "т": "t",
  "в": "b",
  "н": "h",
};

const CATEGORY_LABELS: Record<string, string> = {
  "age-risk": "возрастной риск",
  "consent-risk": "риск согласия",
  "family-role-risk": "семейно-ролевая тема",
  "animal-risk": "недопустимая тема с животными",
  "substance-risk": "риск опьянения или веществ",
  "personal-contact-risk": "риск личного контакта",
  "off-platform-payment-risk": "оплата вне платформы",
  "external-platform-risk": "переход на стороннюю платформу",
  "violence-risk": "риск насилия или вреда",
  "extreme-content-risk": "недопустимый экстремальный запрос",
};

const SEVERITY_BY_CATEGORY: Record<string, Severity> = {
  "age-risk": "critical",
  "consent-risk": "critical",
  "family-role-risk": "critical",
  "animal-risk": "critical",
  "substance-risk": "high",
  "personal-contact-risk": "high",
  "off-platform-payment-risk": "high",
  "external-platform-risk": "high",
  "violence-risk": "critical",
  "extreme-content-risk": "critical",
};

function normalizeBase(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split("")
    .map((character) => LOOKALIKE_MAP[character] ?? character)
    .join("");
}

export function normalizeForRiskScan(value: string): string {
  return normalizeBase(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

const STEM_TERMS = new Set([
  "несовершеннолет",
  "школьниц",
  "изнасил",
  "принуд",
  "шантаж",
  "инцест",
  "зоофил",
  "наркот",
  "крипт",
  "суицид",
  "удуш",
  "лактац",
  "мочеиспуск",
  "фекал",
  "встрет",
]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COMPILED_TERMS = Object.entries(PROHIBITED_TERMS).flatMap(([category, terms]) =>
  terms.map((term) => {
    const normalized = normalizeForRiskScan(term);
    const fuzzy = normalized
      .split("")
      .map(escapeRegex)
      .join("[^\\p{L}\\p{N}]*");
    return {
      category,
      normalized,
      isStem: STEM_TERMS.has(term),
      fuzzyRegex: new RegExp(`(?:^|[^\\p{L}\\p{N}])${fuzzy}(?=$|[^\\p{L}\\p{N}])`, "iu"),
    };
  }),
);

export function scanProhibited(value: string): RiskHit[] {
  const normalizedBase = normalizeBase(value);
  if (!normalizeForRiskScan(value)) return [];
  const tokens = normalizedBase.split(/[^\p{L}\p{N}]+/gu).filter(Boolean);

  const categories = new Set<string>();
  for (const term of COMPILED_TERMS) {
    const tokenMatch = term.isStem
      ? tokens.some((token) => token.startsWith(term.normalized))
      : tokens.includes(term.normalized);
    if (term.normalized && (tokenMatch || term.fuzzyRegex.test(normalizedBase))) {
      categories.add(term.category);
    }
  }

  return [...categories].map((category) => ({
    category,
    severity: SEVERITY_BY_CATEGORY[category] ?? "high",
  }));
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? "риск правил платформы";
}

function safeBoundaryReplies(): ReplyVariant[] {
  return [
    {
      tone: "warm",
      labelRu: "Тёплый",
      ru: "Спасибо, что поделился своим желанием. Я не могу продолжать эту тему, но с удовольствием предложу другой вариант в рамках правил. Какой разрешённый формат тебе нравится больше?",
      en: "Thank you for sharing what you want. I can’t continue with that topic, but I’d be happy to suggest another option that follows the platform rules. Which permitted format do you enjoy most?",
    },
    {
      tone: "playful",
      labelRu: "Игривый",
      ru: "У тебя смелая фантазия, но здесь нам лучше выбрать другой сюжет в рамках правил. Хочешь, я предложу пару безопасных вариантов?",
      en: "That is a bold fantasy, but we should choose a different scenario that follows the platform rules. Would you like me to suggest a couple of safe alternatives?",
    },
    {
      tone: "firm",
      labelRu: "Твёрдый",
      ru: "Я не обсуждаю эту тему. Давай продолжим только в рамках правил и взаимного уважения. Какой другой формат ты хотел бы выбрать?",
      en: "I don’t discuss that topic. Let’s continue within the platform rules and with mutual respect. What other format would you like to choose?",
    },
  ];
}

function allResultText(result: AuditResult): string {
  return [
    result.stage,
    result.summary,
    ...result.strengths,
    ...result.issues.flatMap((issue) => [issue.category, issue.explanation, issue.howToFix]),
    ...result.missingContext,
    ...result.memberFacts.flatMap((fact) => [fact.field, fact.value]),
    ...result.replyVariants.flatMap((reply) => [reply.labelRu, reply.ru, reply.en]),
  ].join("\n");
}

function isSafeText(value: string): boolean {
  return scanProhibited(value).length === 0;
}

export function enforceOutputSafety(result: AuditResult, inputRisks: RiskHit[]): AuditResult {
  const outputRisks = scanProhibited(allResultText(result));
  const combinedCategories = new Map<string, RiskHit>();
  for (const risk of [...inputRisks, ...outputRisks]) combinedCategories.set(risk.category, risk);

  if (combinedCategories.size === 0) {
    return {
      ...result,
      score: Math.max(0, Math.min(100, Math.round(result.score))),
      replyVariants: result.replyVariants.slice(0, 3),
    };
  }

  const safetyIssues: AuditIssue[] = [...combinedCategories.values()].map((risk) => ({
    severity: risk.severity,
    category: categoryLabel(risk.category),
    explanation: "Обнаружена формулировка, которая требует безопасной замены.",
    howToFix: "Не повторять исходное выражение и предложить разрешённую альтернативу.",
  }));

  return {
    ...result,
    score: Math.max(0, Math.min(100, Math.round(result.score))),
    stage: isSafeText(result.stage) ? result.stage : "проверка правил",
    summary: isSafeText(result.summary)
      ? result.summary
      : "В исходном диалоге обнаружена запрещённая тематика. Опасные формулировки скрыты.",
    strengths: result.strengths.filter(isSafeText),
    issues: [
      ...safetyIssues,
      ...result.issues.filter((issue) => isSafeText(`${issue.category} ${issue.explanation} ${issue.howToFix}`)),
    ].slice(0, 10),
    missingContext: result.missingContext.filter(isSafeText),
    memberFacts: result.memberFacts.filter((fact) => isSafeText(`${fact.field} ${fact.value}`)),
    replyVariants: safeBoundaryReplies(),
    safeToSend: false,
  };
}

export function makeFallbackResult(inputRisks: RiskHit[], reason: string): AuditResult {
  const issues: AuditIssue[] = inputRisks.map((risk) => ({
    severity: risk.severity,
    category: categoryLabel(risk.category),
    explanation: "Диалог содержит тему, которую нельзя воспроизводить в ответе.",
    howToFix: "Использовать нейтральный отказ и предложить разрешённую альтернативу.",
  }));

  if (issues.length === 0) {
    issues.push({
      severity: "medium",
      category: "требуется ручная проверка",
      explanation: reason,
      howToFix: "Проверьте контекст и сформулируйте короткий естественный ответ с встречным вопросом.",
    });
  }

  return {
    score: inputRisks.length > 0 ? 35 : 55,
    stage: "требуется ручная проверка",
    summary: "Автоматический разбор не завершён полностью. Используйте безопасный вариант и проверьте контекст вручную.",
    strengths: [],
    issues,
    missingContext: ["контекст предыдущего общения", "цель текущего ответа"],
    memberFacts: [],
    replyVariants: safeBoundaryReplies(),
    safeToSend: inputRisks.length === 0,
  };
}
