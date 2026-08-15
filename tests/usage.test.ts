import { describe, expect, it } from "vitest";

import { reserveUsage, usageSnapshot } from "../src/usage.js";

describe("local spending guard", () => {
  it("counts an estimated text request and exposes the remaining budget", () => {
    const before = usageSnapshot();
    const reservation = reserveUsage("translation");
    reservation.settleText({ input_tokens: 1_000, output_tokens: 1_000 });
    const after = usageSnapshot();

    expect(after.operations.translation).toBe(before.operations.translation + 1);
    expect(after.estimatedUsd).toBeGreaterThan(before.estimatedUsd);
    expect(after.remainingUsd).toBeLessThan(before.remainingUsd);
  });
});
