/** A database whose name ends in "_test": the only kind tests may use (no side effects, safe to import anywhere). */
export const isTestDatabase = (url: string): boolean => {
  try {
    return /_test$/.test(decodeURIComponent(new URL(url).pathname.replace(/^\//, "")));
  } catch {
    return false;
  }
};

const LOOPBACK = ["localhost", "127.0.0.1", "::1", "[::1]"];

/**
 * A database tests may connect to: its name ends in "_test" AND it is on this machine
 * (the isolated container from docker-compose.test.yml). A remote test database is
 * accepted only when TEST_DATABASE_ALLOW_REMOTE=1 is set explicitly — so a URL copied
 * from server/.env (production) can never be used by accident.
 */
export const isSafeTestDatabase = (url: string, allowRemote = process.env.TEST_DATABASE_ALLOW_REMOTE === "1"): boolean => {
  if (!isTestDatabase(url)) return false;
  try {
    return allowRemote || LOOPBACK.includes(new URL(url).hostname);
  } catch {
    return false;
  }
};
