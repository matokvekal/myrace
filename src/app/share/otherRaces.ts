/**
 * Other Bike Races (0.3.4): public races this browser opened through a share link.
 * Browser-local only (localStorage), never sent anywhere, no server table, and kept
 * apart from the account's own and judged races (those are the server's My Races).
 * Holds only what the public page already showed: token, name, date, location.
 */
const KEY = "commissaire.otherRaces.v1";
const MAX = 20;

export interface OtherRace {
  token: string;
  name: string;
  date: string | null;
  location: string | null;
  openedAt: number;
}

const TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function listOtherRaces(): OtherRace[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r): r is OtherRace => !!r && typeof r.token === "string" && TOKEN_RE.test(r.token) && typeof r.name === "string")
      .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0));
  } catch {
    return [];
  }
}

function save(list: OtherRace[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* private mode / quota: the list is a convenience */
  }
}

export function rememberOtherRace(r: { token: string; name?: string | null; date?: string | null; location?: string | null }, now = Date.now()) {
  if (!TOKEN_RE.test(r.token)) return;
  const rest = listOtherRaces().filter((x) => x.token !== r.token);
  save([{ token: r.token, name: String(r.name || "Race").slice(0, 120), date: r.date ?? null, location: r.location ?? null, openedAt: now }, ...rest]);
}

export function forgetOtherRace(token: string) {
  save(listOtherRaces().filter((x) => x.token !== token));
}
