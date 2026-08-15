import { config } from "./config.js";

export type UsageOperation = "audit" | "translation" | "voice";

interface DailyUsage {
  day: string;
  estimatedUsd: number;
  reservedUsd: number;
  operations: Record<UsageOperation, number>;
}

export interface UsageSnapshot {
  date: string;
  limitUsd: number;
  estimatedUsd: number;
  remainingUsd: number;
  operations: Record<UsageOperation, number>;
}

export interface UsageReservation {
  settleText(usage: unknown): void;
  settleEstimate(): void;
  cancel(): void;
}

const RESERVED_COST: Record<UsageOperation, number> = {
  translation: 0.01,
  audit: 0.08,
  voice: 0.02,
};

const TEXT_PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
};

let daily: DailyUsage = emptyUsage(today());

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyUsage(day: string): DailyUsage {
  return {
    day,
    estimatedUsd: 0,
    reservedUsd: 0,
    operations: { audit: 0, translation: 0, voice: 0 },
  };
}

function currentUsage(): DailyUsage {
  const day = today();
  if (daily.day !== day) daily = emptyUsage(day);
  return daily;
}

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function numberFromUsage(usage: unknown, key: "input_tokens" | "output_tokens"): number {
  if (!usage || typeof usage !== "object") return 0;
  const value = (usage as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function textCost(usage: unknown): number | undefined {
  const inputTokens = numberFromUsage(usage, "input_tokens");
  const outputTokens = numberFromUsage(usage, "output_tokens");
  if (inputTokens === 0 && outputTokens === 0) return undefined;
  const price = TEXT_PRICE_PER_MILLION[config.openAiModel]
    ?? TEXT_PRICE_PER_MILLION["gpt-5.4-mini"]
    ?? { input: 0.75, output: 4.5 };
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function reserveUsage(operation: UsageOperation): UsageReservation {
  const state = currentUsage();
  const reserve = RESERVED_COST[operation];
  if (state.estimatedUsd + state.reservedUsd + reserve > config.dailySpendLimitUsd) {
    throw new Error(`Достигнут дневной лимит расходов $${config.dailySpendLimitUsd.toFixed(2)}. Лимит обновится завтра.`);
  }

  state.reservedUsd += reserve;
  let completed = false;

  function settle(cost: number): void {
    if (completed) return;
    completed = true;
    state.reservedUsd = Math.max(0, state.reservedUsd - reserve);
    state.estimatedUsd = rounded(state.estimatedUsd + Math.max(0, cost));
    state.operations[operation] += 1;
  }

  return {
    settleText(usage) {
      settle(textCost(usage) ?? reserve);
    },
    settleEstimate() {
      settle(reserve);
    },
    cancel() {
      if (completed) return;
      completed = true;
      state.reservedUsd = Math.max(0, state.reservedUsd - reserve);
    },
  };
}

export function usageSnapshot(): UsageSnapshot {
  const state = currentUsage();
  return {
    date: state.day,
    limitUsd: config.dailySpendLimitUsd,
    estimatedUsd: rounded(state.estimatedUsd + state.reservedUsd),
    remainingUsd: rounded(Math.max(0, config.dailySpendLimitUsd - state.estimatedUsd - state.reservedUsd)),
    operations: { ...state.operations },
  };
}

export function formatUsageSummary(): string {
  const snapshot = usageSnapshot();
  return [
    `Оценка расходов сегодня: ~$${snapshot.estimatedUsd.toFixed(4)} из $${snapshot.limitUsd.toFixed(2)}`,
    `Осталось по локальному лимиту: ~$${snapshot.remainingUsd.toFixed(4)}`,
    `Аудиты: ${snapshot.operations.audit} · Переводы: ${snapshot.operations.translation} · Голосовые: ${snapshot.operations.voice}`,
    "Сумма ориентировочная: окончательный расход отображается в OpenAI Platform.",
  ].join("\n");
}
