/**
 * A user-typed link, safe to use as an href: http(s) only, so a `javascript:` value
 * in a shared or imported race can't run. A bare "site.com/rules" gets https://.
 * Returns null when it isn't a usable link.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(v);
  try {
    const url = new URL(hasScheme ? v : `https://${v}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.includes(".") || url.hostname === "localhost" ? url.href : null;
  } catch {
    return null;
  }
}
