import { describe, expect, it } from "vitest";

import { scanProhibited } from "../src/filter.js";
import { translateText } from "../src/translator.js";

describe("translator safety", () => {
  it("replaces risky input with a safe boundary instead of translating it", async () => {
    const result = await translateText("Can we m.e.e.t later?", "en-ru");
    expect(result.safe).toBe(false);
    expect(scanProhibited(result.text)).toEqual([]);
  });
});
