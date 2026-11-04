/**
 * Database TLS (src/db/tls.ts): a non-local database is always verified, a private
 * CA can be trusted, verification can never be turned off. Settings only — no
 * database (restored from the PGlite-era test; the handshake part needed PGlite).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { databaseConnection, isLocal } from "../src/db/tls";

const REMOTE = "postgresql://app:s3cret-pass@db.example.org:5432/commissaire";

describe("connection settings", () => {
  it("a local database uses no TLS unless the URL asks for it", () => {
    expect(databaseConnection("postgresql://u:p@127.0.0.1:5433/postgres").ssl).toBe(false);
    expect(databaseConnection("postgresql://u:p@[::1]:5433/postgres").ssl).toBe(false);
    expect(databaseConnection("postgresql://u:p@localhost/x?sslmode=verify-full").ssl).toMatchObject({ rejectUnauthorized: true });
    expect(isLocal(REMOTE)).toBe(false);
  });

  it("a non-local database always verifies, whatever sslmode says, and the TLS parameters leave the URL", () => {
    for (const q of ["", "?sslmode=require", "?sslmode=prefer", "?sslmode=verify-ca", "?ssl=true"]) {
      const c = databaseConnection(REMOTE + q);
      expect(c.ssl).toEqual({ rejectUnauthorized: true });
      expect(new URL(c.connectionString).search).toBe("");
    }
    // Other parameters are kept.
    expect(databaseConnection(REMOTE + "?sslmode=require&application_name=api").connectionString).toContain("application_name=api");
  });

  it("verification cannot be turned off, and errors never show the password", () => {
    for (const q of ["?sslmode=disable", "?sslmode=no-verify", "?ssl=no-verify"]) {
      let msg = "";
      try {
        databaseConnection(REMOTE + q);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg, q).toMatch(/Invalid database TLS configuration/);
      expect(msg).not.toContain("s3cret-pass");
    }
    expect(() => databaseConnection("not a url with s3cret-pass")).toThrow(/^(?!.*s3cret-pass).*not a valid URL/);
  });

  it("the trusted CA comes from DATABASE_CA_CERT (with \\n escapes), a file, or sslrootcert", () => {
    const pem = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n";
    expect(databaseConnection(REMOTE, { caCert: pem.replace(/\n/g, "\\n") }).ssl).toMatchObject({ ca: pem, rejectUnauthorized: true });
    const dir = mkdtempSync(join(tmpdir(), "ca-"));
    try {
      writeFileSync(join(dir, "ca.pem"), pem);
      expect(databaseConnection(REMOTE, { caCertFile: join(dir, "ca.pem") }).ssl).toMatchObject({ ca: pem });
      expect(databaseConnection(`${REMOTE}?sslrootcert=${encodeURIComponent(join(dir, "ca.pem"))}`).ssl).toMatchObject({ ca: pem });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(() => databaseConnection(REMOTE, { caCert: "not a certificate" })).toThrow(/not a PEM certificate/);
    expect(() => databaseConnection(REMOTE, { caCertFile: "/no/such/ca.pem" })).toThrow(/cannot read the CA certificate file/);
  });
});

