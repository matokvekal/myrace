import { readFileSync } from "node:fs";
import { checkServerIdentity, type ConnectionOptions } from "node:tls";

/** Loopback hosts: the local PGlite dev database and the test database. */
export const isLocal = (url: string) => {
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

export interface TlsSettings {
  /** PEM of the CA (or self-signed server certificate) to trust; "\n" escapes allowed. */
  caCert?: string;
  /** Path to that PEM file. */
  caCertFile?: string;
  /** Name the server certificate must carry, when it differs from the URL host (e.g. connecting by IP). */
  servername?: string;
}

// libpq-style TLS parameters that pg would otherwise turn into its own ssl
// object, replacing ours. They are read here, then removed from the URL.
const URL_TLS_PARAMS = ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"];
const TLS_MODES = ["require", "verify-ca", "verify-full"];

const fail = (why: string) => new Error(`Invalid database TLS configuration — ${why}`);

/**
 * The pg connection string and TLS options for DATABASE_URL.
 *
 * - A non-local host always uses TLS with full verification: the chain must
 *   lead to a trusted CA and the certificate must name the host. The trusted CA
 *   is DATABASE_CA_CERT / DATABASE_CA_CERT_FILE (or sslrootcert in the URL);
 *   without one, Node's public CA list. Verification cannot be turned off:
 *   sslmode=disable and ssl=no-verify are refused.
 * - A loopback host uses no TLS unless the URL asks for it (sslmode=require,
 *   verify-ca or verify-full), which is then verified the same way.
 * Errors never include the URL (it holds the password).
 */
export function databaseConnection(url: string, tls: TlsSettings = {}): { connectionString: string; ssl: false | ConnectionOptions } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw fail("DATABASE_URL is not a valid URL");
  }
  const p = u.searchParams;
  const ssl = p.get("ssl");
  const mode = p.get("sslmode") ?? (ssl === "true" || ssl === "1" ? "require" : null);
  if (ssl === "no-verify" || mode === "no-verify") throw fail("certificate verification cannot be turned off; trust the server's CA with DATABASE_CA_CERT_FILE");
  const rootFile = p.get("sslrootcert"), certFile = p.get("sslcert"), keyFile = p.get("sslkey");
  for (const k of URL_TLS_PARAMS) p.delete(k);
  const connectionString = u.toString();

  if (isLocal(url) && !(mode && TLS_MODES.includes(mode))) return { connectionString, ssl: false };
  if (mode === "disable") throw fail("a non-local database must use TLS; remove sslmode=disable");

  const read = (file: string, what: string) => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      throw fail(`cannot read the ${what} file`);
    }
  };
  const caFile = tls.caCertFile || rootFile;
  const ca = tls.caCert ? tls.caCert.replace(/\\n/g, "\n") : caFile ? read(caFile, "CA certificate") : undefined;
  if (ca !== undefined && !ca.includes("-----BEGIN CERTIFICATE-----")) throw fail("the CA certificate is not a PEM certificate");

  const options: ConnectionOptions = { rejectUnauthorized: true };
  if (ca) options.ca = ca;
  if (certFile) options.cert = read(certFile, "client certificate");
  if (keyFile) options.key = read(keyFile, "client key");
  if (tls.servername) {
    // pg sets servername to the URL host when it is a name, so check the
    // configured name explicitly; the chain is still verified (rejectUnauthorized).
    const name = tls.servername;
    options.servername = name;
    options.checkServerIdentity = (_host, cert) => checkServerIdentity(name, cert);
  }
  return { connectionString, ssl: options };
}
