import { describe, expect, it } from "vitest";

import { splitTelegramMessage } from "../src/format.js";

describe("Telegram message splitting", () => {
  it("keeps every part under the configured limit", () => {
    const parts = splitTelegramMessage(["A".repeat(900), "B".repeat(900), "C".repeat(900)].join("\n\n"), 1000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 1000)).toBe(true);
  });
});
