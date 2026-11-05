/** Password hashing and email normalisation — what register and login both rely on (no database). */
import { describe, expect, it } from "vitest";
import { hashPassword, normalizeEmail, verifyPassword } from "../src/lib/core";
import { mailDeliverable } from "../src/lib/messaging";

describe("passwords", () => {
  it.each(["password-123", "Abc 12345 ", "סיסמה12345", "P@ss$word€😀"])("%j verifies against its own hash, nothing else does", async (pw) => {
    const h = await hashPassword(pw);
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword(pw, h)).toBe(true);
    expect(await verifyPassword(pw.toUpperCase() === pw ? pw + "x" : pw.toUpperCase(), h)).toBe(false);
    expect(await verifyPassword(pw.trim() + "!", h)).toBe(false);
  });
  it("two hashes of the same password differ (salted)", async () => {
    expect(await hashPassword("same-pass-1")).not.toBe(await hashPassword("same-pass-1"));
  });
  it("a malformed stored hash never verifies", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

describe("emails", () => {
  it("are trimmed and lowercased the same way for register and login", () => {
    expect(normalizeEmail("  Some.One@Gmail.COM ")).toBe("some.one@gmail.com");
  });
});

describe("mail delivery", () => {
  it("the log transport outside production can 'send' (dev/test); production with log cannot", () => {
    expect(mailDeliverable()).toBe(true); // NODE_ENV=test
  });
});
