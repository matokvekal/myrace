const EL_NINO_HOME = "https://el-nino.site";
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const EL_NINO_EVENTS_PREFIX = "el-nino.site/events/";

/**
 * The event id from a typed id, a pasted link or a scanned QR. Only an id, or a
 * link on El Niño's own /events/ path, counts: the start of the URL is fixed, so
 * a race can never point this link somewhere else. Null when it isn't one.
 */
export function parseElNinoEventId(input: string | null | undefined): string | null {
  const v = input?.trim();
  if (!v) return null;
  if (EVENT_ID.test(v)) return v.toLowerCase();
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (url.hostname !== "el-nino.site" && url.hostname !== "www.el-nino.site") return null;
    const id = url.pathname.match(/^\/events\/([^/]+)\/?$/)?.[1];
    return id && EVENT_ID.test(id) ? id.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The race's El Niño event, or El Niño's home page when none is set. */
export function elNinoUrl(eventId: string | null | undefined): string {
  const id = parseElNinoEventId(eventId);
  return id ? `${EL_NINO_HOME}/events/${id}` : EL_NINO_HOME;
}
