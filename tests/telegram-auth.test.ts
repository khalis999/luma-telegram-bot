import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { validateTelegramInitData } from "../src/telegram-auth.js";

function signedInitData(token: string, userId: number): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "test-query",
    user: JSON.stringify({ id: userId, first_name: "Tester" }),
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return params.toString();
}

describe("Telegram Mini App authentication", () => {
  it("accepts a correctly signed payload", () => {
    expect(validateTelegramInitData(signedInitData("token", 123), "token")).toEqual({ valid: true, userId: 123 });
  });

  it("rejects a payload signed with another token", () => {
    expect(validateTelegramInitData(signedInitData("token", 123), "different")).toEqual({ valid: false });
  });
});
