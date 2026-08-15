import type { AuditResult } from "./types.js";

const TONE_ICON: Record<string, string> = {
  warm: "🤍",
  playful: "✨",
  firm: "🛡️",
};

export function formatAudit(result: AuditResult): string {
  const lines: string[] = [
    `LUMA · АУДИТ ${result.score}/100`,
    `Этап: ${result.stage}`,
    "",
    result.summary,
  ];

  if (result.strengths.length > 0) {
    lines.push("", "Что сделано хорошо:");
    result.strengths.forEach((item) => lines.push(`• ${item}`));
  }

  if (result.issues.length > 0) {
    lines.push("", "Что исправить:");
    result.issues.slice(0, 6).forEach((issue) => {
      lines.push(`• [${issue.severity.toUpperCase()}] ${issue.category}`);
      lines.push(`  ${issue.explanation}`);
      lines.push(`  Решение: ${issue.howToFix}`);
    });
  }

  if (result.missingContext.length > 0) {
    lines.push("", "Чего не хватает:");
    result.missingContext.slice(0, 6).forEach((item) => lines.push(`• ${item}`));
  }

  lines.push("", result.safeToSend ? "✅ Ответы прошли фильтр" : "⚠️ Использована безопасная замена");

  result.replyVariants.slice(0, 3).forEach((reply) => {
    const icon = TONE_ICON[reply.tone] ?? "•";
    lines.push("", `${icon} ${reply.labelRu}`, `RU: ${reply.ru}`, `EN: ${reply.en}`);
  });

  return lines.join("\n");
}

export function splitTelegramMessage(text: string, limit = 3800): string[] {
  if (text.length <= limit) return [text];

  const paragraphs = text.split("\n\n");
  const parts: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > limit) {
      if (current) parts.push(current);
      for (let index = 0; index < paragraph.length; index += limit) {
        parts.push(paragraph.slice(index, index + limit));
      }
      current = "";
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > limit) {
      parts.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }

  if (current) parts.push(current);
  return parts;
}
