/**
 * The shared race page — what a GUEST sees when opening a race's share link
 * (/share/:token). Read-only and standalone: data comes only from the public
 * endpoints (services/live/publicRace.ts), never from the management API, the
 * local stores or IndexedDB, so nothing here can change a race.
 *
 * Tabs: Info · Riders · Categories · Schedule · Board · Results.
 *
 * Guest polling (shared/race/guestPolling.ts, enforced by the server too):
 * starts when the page opens, runs while the race is active, stops when the
 * race is finished or 24 h after its scheduled start (the server then answers
 * 410 and the page loads the race one last time). Paused while the tab is hidden.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Calendar, Clock, ExternalLink, MapPin, Radio, Search, Trophy, Users } from "lucide-react";
import { fetchPublicChanges, fetchPublicRace, PublicApiError, type PublicPolling } from "@/services/live/publicRace";
import { guestPollingOpen } from "../../shared/race/guestPolling";
import type { SharedCategory, SharedRace, SharedRider } from "../../shared/race/state";
import { safeHttpUrl } from "@/utils/safeUrl";
import styles from "./sharePage.module.css";
import { STATUS_LABEL } from "@/utils/statusLabels";

type Rider = Partial<SharedRider>;
type Tab = "info" | "riders" | "categories" | "schedule" | "board" | "results";
const TABS: { key: Tab; label: string }[] = [
  { key: "info", label: "Info" },
  { key: "riders", label: "Riders" },
  { key: "categories", label: "Categories" },
  { key: "schedule", label: "Schedule" },
  { key: "board", label: "Board" },
  { key: "results", label: "Results" },
];

const OUT = ["DNF", "DSQ", "DNS"];
const catKey = (name?: string | null, sub?: string | null) => `${name ?? ""}::${sub ?? ""}`;
const fullName = (r: Rider) => [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" ");
const catLabel = (c: Pick<SharedCategory, "name" | "subCategory">) => (c.subCategory ? `${c.name} ${c.subCategory}` : c.name);

/** Classified first (by the server's category position), then on course by laps, then DNF/DSQ/DNS. */
function rankRiders(list: Rider[]): Rider[] {
  const score = (r: Rider) => (OUT.includes(String(r.status)) ? 2 : r.position_category ? 0 : 1);
  return [...list].sort(
    (a, b) =>
      score(a) - score(b) ||
      (a.position_category ?? 1e9) - (b.position_category ?? 1e9) ||
      (b.lapsCounter ?? 0) - (a.lapsCounter ?? 0) ||
      (a.bibNumber ?? 1e9) - (b.bibNumber ?? 1e9),
  );
}

function statusText(r: Rider): string {
  if (OUT.includes(String(r.status))) return String(r.status);
  if (r.raceStatus === "finished" || r.status === "finished") return "Finished";
  if (r.raceStatus === "running") return "On course";
  return "Not started";
}

function categoryState(c: SharedCategory): string {
  if (c.status === "running") return STATUS_LABEL.running;
  if (c.status === "finished") return c.startedAt != null ? STATUS_LABEL.finished : STATUS_LABEL.upcoming;
  return STATUS_LABEL.upcoming;
}

export default function SharePage() {
  const { token = "" } = useParams();
  const [race, setRace] = useState<Partial<SharedRace> | null>(null);
  const [categories, setCategories] = useState<Map<string, SharedCategory>>(new Map());
  const [riders, setRiders] = useState<Map<string, Rider>>(new Map());
  const [polling, setPolling] = useState<PublicPolling | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // 0.3.2: a shared Board / Results link opens on that screen (?tab=board|results), also after refresh.
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (params.get("tab") === "results" ? "results" : "board"));
  const seq = useRef(0);

  const loadAll = useCallback(async () => {
    const r = await fetchPublicRace(token);
    seq.current = r.lastSeq;
    setRace(r.race);
    setCategories(new Map(r.categories.map((c) => [c.uuid, c])));
    setRiders(new Map(r.riders.filter((x) => x.uuid).map((x) => [x.uuid!, x])));
    setPolling(r.polling);
    setUpdatedAt(Date.now());
    setOffline(false);
  }, [token]);

  // Open the race (always allowed — also once it is finished).
  useEffect(() => {
    let cancelled = false;
    loadAll().catch((e) => {
      if (!cancelled) setError(e instanceof PublicApiError && e.status === 404 ? "This race link is not valid or the race was removed." : e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [loadAll]);

  const categoryList = useMemo(() => [...categories.values()], [categories]);
  const live = !!polling?.open && !!race && guestPollingOpen(race, categoryList, Date.now());

  // Guest polling: only while the race is active, paused while the tab is hidden.
  useEffect(() => {
    if (!live || !polling) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          const ch = await fetchPublicChanges(token, seq.current);
          setOffline(false);
          setUpdatedAt(Date.now());
          if (ch.full) {
            seq.current = ch.lastSeq;
            setRace(ch.race ?? null);
            setCategories(new Map((ch.categories ?? []).map((c) => [c.uuid, c])));
            setRiders(new Map((ch.riders ?? []).filter((x) => x.uuid).map((x) => [x.uuid!, x])));
          } else if (!ch.unchanged) {
            seq.current = ch.lastSeq;
            if (ch.race) setRace(ch.race);
            if (ch.categories?.length) setCategories((m) => { const n = new Map(m); for (const c of ch.categories!) n.set(c.uuid, c); return n; });
            if (ch.riders?.length) setRiders((m) => { const n = new Map(m); for (const r of ch.riders!) if (r.uuid) n.set(r.uuid, r); return n; });
          }
          setPolling(ch.polling); // closes the loop when the race finished or the window ended
          if (!ch.polling.open) return;
        } catch (e) {
          if (e instanceof PublicApiError && e.status === 410) {
            // Live updates ended: load the race one last time, then stop.
            await loadAll().catch(() => {});
            setPolling((p) => (p ? { ...p, open: false } : p));
            return;
          }
          setOffline(true); // keep trying while the race is active
        }
      }
      timer = setTimeout(() => void tick(), polling.intervalMs);
    };
    timer = setTimeout(() => void tick(), polling.intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible" && timer) {
        clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [live, polling?.intervalMs, token, loadAll]); // eslint-disable-line react-hooks/exhaustive-deps

  const ridersByCat = useMemo(() => {
    const m = new Map<string, Rider[]>();
    for (const r of riders.values()) {
      const k = catKey(r.category, r.subCategory);
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    }
    return m;
  }, [riders]);

  const sortedCats = useMemo(
    () =>
      [...categoryList].sort(
        (a, b) => (a.heat ?? 999) - (b.heat ?? 999) || String(a.startTime ?? "").localeCompare(String(b.startTime ?? "")) || (a.importOrder ?? 0) - (b.importOrder ?? 0) || a.name.localeCompare(b.name),
      ),
    [categoryList],
  );

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.errorCard} role="alert">
          <h1>Race not available</h1>
          <p dir="auto">{error}</p>
          <Link to="/" className={styles.homeLink}>Go to Commissaire</Link>
        </div>
      </div>
    );
  }
  if (!race) return <div className={styles.page}><div className={styles.loading}>Loading race…</div></div>;

  const finished = race.status === "finished";
  const liveLabel = finished ? "Final results" : live ? (offline ? "Reconnecting…" : "Live") : "Live updates ended";

  return (
    <div className={styles.page} data-testid="share-page">
      <header className={styles.header}>
        <div className={styles.brand}>Commissaire</div>
        <h1 className={styles.raceName} dir="auto">{race.name}</h1>
        <div className={styles.meta}>
          {race.date && <span><Calendar size={14} /> {race.date}</span>}
          {race.time && <span><Clock size={14} /> {race.time}</span>}
          {race.location && <span dir="auto"><MapPin size={14} /> {race.location}</span>}
        </div>
        <div className={styles.liveRow}>
          <span className={`${styles.livePill} ${live && !offline ? styles.liveOn : finished ? styles.liveFinal : styles.liveOff}`} data-testid="share-live-state" data-live={live ? "on" : "off"}>
            {live ? <Radio size={13} /> : <Trophy size={13} />} {liveLabel}
          </span>
          {updatedAt && <span className={styles.updated}>Updated {new Date(updatedAt).toLocaleTimeString()}</span>}
          <span className={styles.readOnly}>Read-only</span>
        </div>
      </header>

      <nav className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? styles.tabOn : styles.tab} onClick={() => setTab(t.key)} data-testid={`share-tab-${t.key}`}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className={styles.content}>
        {tab === "info" && <InfoTab race={race} riders={riders.size} categories={categoryList.length} />}
        {tab === "riders" && <RidersTab riders={[...riders.values()]} />}
        {tab === "categories" && <CategoriesTab categories={sortedCats} ridersByCat={ridersByCat} />}
        {tab === "schedule" && <ScheduleTab categories={sortedCats} ridersByCat={ridersByCat} />}
        {tab === "board" && <BoardTab categories={sortedCats.filter((c) => c.status === "running" || c.startedAt != null)} ridersByCat={ridersByCat} />}
        {tab === "results" && <ResultsTab categories={sortedCats} ridersByCat={ridersByCat} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

function InfoTab({ race, riders, categories }: { race: Partial<SharedRace>; riders: number; categories: number }) {
  const site = safeHttpUrl(race.site);
  const rows: [string, React.ReactNode][] = [
    ["Date", race.date],
    ["Start time", race.time],
    ["Location", race.location],
    ["Type", race.raceType || race.type],
    ["Level", race.level],
    ["Organizer", race.orgenizer || race.owner],
    ["Distance", race.distance ? `${race.distance} km` : null],
    ["Categories", categories],
    ["Riders", riders],
  ];
  return (
    <section className={styles.card}>
      {race.image && /^(https?:|data:image\/)/.test(race.image) && <img className={styles.cover} src={race.image} alt="" />}
      <dl className={styles.infoList}>
        {rows.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
          <div key={k} className={styles.infoRow}>
            <dt>{k}</dt>
            <dd dir="auto">{v}</dd>
          </div>
        ))}
      </dl>
      {site && (
        <a className={styles.siteLink} href={site} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={14} /> Race website
        </a>
      )}
      {race.takanon && (
        <details className={styles.rules}>
          <summary>Race rules</summary>
          <p dir="auto">{race.takanon}</p>
        </details>
      )}
    </section>
  );
}

function RidersTab({ riders }: { riders: Rider[] }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return riders
      .filter((r) => !s || String(r.bibNumber ?? "").includes(s) || fullName(r).toLowerCase().includes(s) || String(r.team ?? "").toLowerCase().includes(s) || String(r.category ?? "").toLowerCase().includes(s))
      .sort((a, b) => (a.bibNumber ?? 1e9) - (b.bibNumber ?? 1e9) || fullName(a).localeCompare(fullName(b)));
  }, [riders, q]);
  return (
    <section>
      <label className={styles.search}>
        <Search size={16} aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bib, name, team or category" dir="auto" />
      </label>
      <p className={styles.count}><Users size={14} /> {list.length} rider{list.length === 1 ? "" : "s"}</p>
      <ul className={styles.list}>
        {list.map((r) => (
          <li key={r.uuid} className={styles.riderRow}>
            <span className={styles.bib}>{r.bibNumber ?? "—"}</span>
            <span className={styles.riderMain}>
              <span className={styles.name} dir="auto">{fullName(r)}</span>
              <span className={styles.sub} dir="auto">{[r.team, r.subCategory ? `${r.category} ${r.subCategory}` : r.category].filter(Boolean).join(" · ")}</span>
            </span>
            {OUT.includes(String(r.status)) && <span className={styles.outChip}>{r.status}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

const Swatch = ({ color }: { color: string | null }) => <span className={styles.swatch} style={{ background: color ?? "var(--border-card)" }} aria-hidden="true" />;

function CategoriesTab({ categories, ridersByCat }: { categories: SharedCategory[]; ridersByCat: Map<string, Rider[]> }) {
  return (
    <ul className={styles.list}>
      {categories.map((c) => (
        <li key={c.uuid} className={styles.catRow}>
          <Swatch color={c.color} />
          <span className={styles.riderMain}>
            <span className={styles.name} dir="auto">{catLabel(c)}</span>
            <span className={styles.sub}>
              {[c.heat != null ? `Wave ${c.heat}` : null, c.startTime ? `Start ${c.startTime}` : null, c.laps ? `${c.laps} laps` : null, `${ridersByCat.get(catKey(c.name, c.subCategory))?.length ?? 0} riders`].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className={styles.stateChip} data-state={c.status ?? "upcoming"}>{categoryState(c)}</span>
        </li>
      ))}
    </ul>
  );
}

function ScheduleTab({ categories, ridersByCat }: { categories: SharedCategory[]; ridersByCat: Map<string, Rider[]> }) {
  const waves = useMemo(() => {
    const m = new Map<string, SharedCategory[]>();
    for (const c of categories) {
      const k = c.heat != null ? String(c.heat) : "—";
      (m.get(k) ?? m.set(k, []).get(k)!).push(c);
    }
    return [...m.entries()];
  }, [categories]);
  if (waves.length === 0) return <p className={styles.empty}>No schedule yet.</p>;
  return (
    <div className={styles.stack}>
      {waves.map(([wave, cats]) => {
        const starts = cats.map((c) => c.startTime).filter(Boolean).sort();
        return (
          <section key={wave} className={styles.card}>
            <h2 className={styles.cardTitle}>
              {wave === "—" ? "Not scheduled" : `Wave ${wave}`}
              {starts[0] && <span className={styles.cardTitleSide}><Clock size={14} /> {starts[0]}</span>}
            </h2>
            <ul className={styles.list}>
              {cats.map((c) => (
                <li key={c.uuid} className={styles.catRow}>
                  <Swatch color={c.color} />
                  <span className={styles.riderMain}>
                    <span className={styles.name} dir="auto">{catLabel(c)}</span>
                    <span className={styles.sub}>{[c.startTime ? `Start ${c.startTime}` : null, c.laps ? `${c.laps} laps` : null, `${ridersByCat.get(catKey(c.name, c.subCategory))?.length ?? 0} riders`].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className={styles.stateChip} data-state={c.status ?? "upcoming"}>{categoryState(c)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function BoardTab({ categories, ridersByCat }: { categories: SharedCategory[]; ridersByCat: Map<string, Rider[]> }) {
  if (categories.length === 0) return <p className={styles.empty}>No category has started yet. The board fills in once the race starts.</p>;
  return (
    <div className={styles.stack}>
      {categories.map((c) => {
        const list = rankRiders((ridersByCat.get(catKey(c.name, c.subCategory)) ?? []).filter((r) => r.status !== "DNS"));
        return (
          <section key={c.uuid} className={styles.card}>
            <h2 className={styles.cardTitle}>
              <Swatch color={c.color} /> <span dir="auto">{catLabel(c)}</span>
              <span className={styles.stateChip} data-state={c.status ?? "upcoming"}>{categoryState(c)}</span>
            </h2>
            <ol className={styles.list}>
              {list.map((r, i) => (
                <li key={r.uuid} className={styles.resultRow}>
                  <span className={styles.place}>{OUT.includes(String(r.status)) ? "–" : r.position_category ?? i + 1}</span>
                  <span className={styles.bib}>{r.bibNumber ?? "—"}</span>
                  <span className={styles.riderMain}>
                    <span className={styles.name} dir="auto">{fullName(r)}</span>
                    <span className={styles.sub}>
                      {[`Lap ${r.lapsCounter ?? 0}${c.laps ? `/${c.laps}` : ""}`, r.elapsedTimeFromStart, statusText(r)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function ResultsTab({ categories, ridersByCat }: { categories: SharedCategory[]; ridersByCat: Map<string, Rider[]> }) {
  const withRiders = categories.filter((c) => (ridersByCat.get(catKey(c.name, c.subCategory)) ?? []).length > 0);
  if (withRiders.length === 0) return <p className={styles.empty}>No results yet.</p>;
  return (
    <div className={styles.stack}>
      {withRiders.map((c) => {
        const list = rankRiders(ridersByCat.get(catKey(c.name, c.subCategory)) ?? []);
        return (
          <section key={c.uuid} className={styles.card}>
            <h2 className={styles.cardTitle}>
              <Swatch color={c.color} /> <span dir="auto">{catLabel(c)}</span>
              <span className={styles.stateChip} data-state={c.status ?? "upcoming"}>{categoryState(c)}</span>
            </h2>
            <ol className={styles.list}>
              {list.map((r) => {
                const out = OUT.includes(String(r.status));
                return (
                  <li key={r.uuid} className={styles.resultRow}>
                    <span className={styles.place}>{out ? "–" : r.position_category ?? "–"}</span>
                    <span className={styles.bib}>{r.bibNumber ?? "—"}</span>
                    <span className={styles.riderMain}>
                      <span className={styles.name} dir="auto">{fullName(r)}</span>
                      <span className={styles.sub} dir="auto">{[r.team, `${r.lapsCounter ?? 0} laps`].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className={styles.time}>{out ? <span className={styles.outChip}>{r.status}</span> : r.elapsedTimeFromStart ?? statusText(r)}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
