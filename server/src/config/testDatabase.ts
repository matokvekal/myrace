/** A database whose name ends in "_test": the only kind tests may use (no side effects, safe to import anywhere). */
export const isTestDatabase = (url: string): boolean => {
  try {
    return /_test$/.test(decodeURIComponent(new URL(url).pathname.replace(/^\//, "")));
  } catch {
    return false;
  }
};
