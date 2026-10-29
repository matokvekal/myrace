/**
 * Database TLS (src/db/tls.ts): a non-local database is always verified, a
 * private CA can be trusted, and verification can never be turned off.
 * The end-to-end part runs a real pg TLS handshake against an in-memory
 * PostgreSQL behind a local TLS proxy with a throwaway CA made by openssl.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, connect, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

// --- End to end -------------------------------------------------------------

let hasOpenssl = true;
try {
  execFileSync("openssl", ["version"], { stdio: "ignore" });
} catch {
  hasOpenssl = false;
}

describe.skipIf(!hasOpenssl)("TLS handshake with a private CA", () => {
  let dir: string, db: PGlite, dbServer: PGLiteSocketServer, proxy: Server, proxyPort: number;
  let tlsSessions = 0;

  const ossl = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  const freePort = () =>
    new Promise<number>((resolve) => {
      const s = createServer().listen(0, "127.0.0.1", () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => resolve(p));
      });
    });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pg-tls-"));
    writeFileSync(join(dir, "san.cnf"), "subjectAltName=DNS:localhost,DNS:db.test,IP:127.0.0.1\n");
    for (const ca of ["ca", "other-ca"]) {
      ossl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${ca}.key`, "-out", `${ca}.crt`, "-days", "1", "-subj", `/CN=Test ${ca}`);
    }
    ossl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=localhost");
    ossl("x509", "-req", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.crt", "-days", "1", "-extfile", "san.cnf");
    const key = readFileSync(join(dir, "server.key")), cert = readFileSync(join(dir, "server.crt"));

    db = await PGlite.create();
    const dbPort = await freePort();
    dbServer = new PGLiteSocketServer({ db, port: dbPort, host: "127.0.0.1" });
    await dbServer.start();

    // Answers PostgreSQL's SSLRequest with 'S', terminates TLS, forwards to the database.
    proxy = createServer((sock) => {
      sock.on("error", () => {});
      sock.once("data", (buf) => {
        if (buf.length !== 8 || buf.readInt32BE(4) !== 80877103) return sock.destroy();
        sock.write("S");
        const secure = new TLSSocket(sock, { isServer: true, key, cert });
        secure.on("error", () => secure.destroy());
        secure.once("secure", () => {
          tlsSessions++;
          const up = connect(dbPort, "127.0.0.1");
          up.on("error", () => secure.destroy());
          secure.pipe(up).pipe(secure);
          secure.on("close", () => up.destroy());
        });
      });
    });
    proxyPort = await new Promise<number>((resolve) => proxy.listen(0, "127.0.0.1", () => resolve((proxy.address() as AddressInfo).port)));
  });

  afterAll(async () => {
    await new Promise((r) => proxy?.close(r));
    await dbServer?.stop();
    await db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const query = async (host: string, tls: Parameters<typeof databaseConnection>[1]) => {
    const client = new pg.Client(databaseConnection(`postgresql://postgres:postgres@${host}:${proxyPort}/postgres?sslmode=verify-full`, tls));
    try {
      await client.connect();
      return (await client.query("SELECT 1 AS ok")).rows[0].ok as number;
    } finally {
      await client.end().catch(() => {});
    }
  };

  it("connects when the server's CA is trusted", async () => {
    const before = tlsSessions;
    expect(await query("localhost", { caCertFile: join(dir, "ca.crt") })).toBe(1);
    expect(tlsSessions).toBe(before + 1);
  });

  it("refuses a certificate whose CA is not trusted (system CAs, or another CA)", async () => {
    const untrusted = /unable to verify the first certificate|self[- ]signed certificate|unable to get (local )?issuer/i;
    await expect(query("localhost", {})).rejects.toThrow(untrusted);
    await expect(query("localhost", { caCertFile: join(dir, "other-ca.crt") })).rejects.toThrow(untrusted);
  });

  it("checks the certificate name: DATABASE_TLS_SERVERNAME must match it", async () => {
    const ca = readFileSync(join(dir, "ca.crt"), "utf8");
    expect(await query("127.0.0.1", { caCert: ca, servername: "db.test" })).toBe(1);
    await expect(query("127.0.0.1", { caCert: ca, servername: "wrong.test" })).rejects.toThrow(/does not match|altnames/i);
    await expect(query("localhost", { caCert: ca, servername: "wrong.test" })).rejects.toThrow(/does not match|altnames/i);
  });
});
