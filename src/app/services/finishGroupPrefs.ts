import { emptyPrefs, type FinishGroupPrefs } from "@/utils/finishGroupLearning";

/**
 * Where an organizer's learned Finish Group preferences live — separate from
 * race data (resetting a race never erases them):
 *  - signed in to the Commissaire server: the account's user_preferences
 *    ("finish_groups"), so they follow the organizer across devices; a local
 *    copy per account is kept for offline use;
 *  - not signed in: this device only.
 * The live client is loaded on demand only (bundle rule), never statically.
 */
const KEY = "finish_groups";
const serverConfigured = () => !!import.meta.env.VITE_SERVER_URL;

async function account(): Promise<{ id: string | null; signedIn: boolean; live: typeof import("./live/liveClient") | null }> {
  if (!serverConfigured()) return { id: null, signedIn: false, live: null };
  const live = await import("./live/liveClient");
  const user = live.useLiveStore.getState().user as { id?: string } | null;
  return { id: user?.id ?? null, signedIn: live.isSignedIn(), live };
}

const localKey = (accountId: string | null) => `commissaire.finishGroupPrefs.${accountId ?? "device"}`;

function readLocal(accountId: string | null): FinishGroupPrefs {
  try {
    const raw = localStorage.getItem(localKey(accountId));
    const v = raw ? (JSON.parse(raw) as FinishGroupPrefs) : null;
    return v && v.version === 1 && v.races ? v : emptyPrefs();
  } catch {
    return emptyPrefs();
  }
}

function writeLocal(accountId: string | null, prefs: FinishGroupPrefs) {
  try {
    localStorage.setItem(localKey(accountId), JSON.stringify(prefs));
  } catch {
    // storage full / private mode: preferences are a convenience only
  }
}

export async function loadFinishGroupPrefs(): Promise<FinishGroupPrefs> {
  const { id, signedIn, live } = await account();
  const local = readLocal(id);
  if (!signedIn || !live) return local;
  try {
    const res = await live.api<{ value: FinishGroupPrefs | null }>("GET", `/me/preferences/${KEY}`);
    if (res.value && res.value.version === 1) {
      writeLocal(id, res.value);
      return res.value;
    }
  } catch {
    // offline: the local copy
  }
  return local;
}

export async function saveFinishGroupPrefs(prefs: FinishGroupPrefs): Promise<void> {
  const { id, signedIn, live } = await account();
  writeLocal(id, prefs);
  if (!signedIn || !live) return;
  try {
    await live.api("PUT", `/me/preferences/${KEY}`, { value: prefs });
  } catch {
    // offline: kept locally, sent with the next change
  }
}
