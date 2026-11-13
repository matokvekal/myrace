/** Results signing key self-check (Finish Race), no database. */
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signingKeyStatus } from "../src/results/routes";

const pem = (type: "ed25519" | "x25519") =>
  generateKeyPairSync(type as "ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("signingKeyStatus", () => {
  it("missing when empty", () => {
    expect(signingKeyStatus("")).toBe("missing");
  });
  it("ok for an Ed25519 PEM, also with \\n escapes (as stored in the env file)", () => {
    const key = pem("ed25519");
    expect(signingKeyStatus(key)).toBe("ok");
    expect(signingKeyStatus(key.trim().replace(/\n/g, "\\n"))).toBe("ok");
  });
  it("invalid for garbage or a key that cannot sign with Ed25519", () => {
    expect(signingKeyStatus("-----BEGIN PRIVATE KEY-----\\nnope\\n-----END PRIVATE KEY-----")).toBe("invalid");
    expect(signingKeyStatus(pem("x25519"))).toBe("invalid");
  });
});
