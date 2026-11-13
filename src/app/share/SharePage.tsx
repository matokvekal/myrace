/**
 * The public spectator page (0.3.4) — what anyone sees when opening a race's share
 * link (/share/:token). No sign-in, read-only, standalone: data comes only from the
 * public endpoints (services/live/publicRace.ts via usePublicRaceFeed), never from
 * the management API, the local stores, IndexedDB or a socket, so nothing here can
 * change a race.
 *
 * 2.0: three tabs — RACE (default: active wave + schedule), RESULTS (official, only once the
 * race is finished; Only Finishers / Filter by Wave) and LIVE (provisional standings of the
 * running wave, computed in the browser). `?tab=race|results|live` (a 0.3.2 `?tab=board`
 * link opens RACE); tab changes are history entries so Back/Forward work. `?view=tv` is the
 * full-screen broadcast presentation (broadcast/), same data and rules.
 *
 * 0.3.5: a category is APPROVED only when the server says so (a judge typed APPROVED and
 * the result hasn't changed since); otherwise its rankings show as PROVISIONAL. The podium
 * is shown only for APPROVED categories.
 */
import React, { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { BadgeCheck, Calendar, ChevronDown, Clock, MapPin, Radio, RefreshCw, Trophy, Tv } from "lucide-react";
import type { SharedCategory } from "../../shared/race/state";
import type { CategoryApprovalView } from "../../shared/race/approval";
import type { RiderProps } from "@/types/types";
import RiderLapTable from "../race/[id]/results/RiderLapTable";
import { STATUS_LABEL } from "@/utils/statusLabels";
import { usePublicRaceFeed, type PublicRider } from "./usePublicRaceFeed";
import { shareTabFromParam, type ShareTab } from "./publicRefresh";
import { listOtherRaces, rememberOtherRace, type OtherRace } from "./otherRaces";
import styles from "./sharePage.module.css";
import { ridersByCategory, summarizeWaves, categoryKey as waveCategoryKey } from "./waves/activeWaves";
import { ActiveWaveStrip } from "./waves/ActiveWaveStrip";
import { useTicker } from "./waves/raceClock";
import { feedFreshness } from "./feedStatus";
import { LiveTab } from "./live/LiveTab";
import liveStyles from "./live/live.module.css";
import { ResultsFilters } from "./results/ResultsFilters";
import { filterResultCategories, filterResultRiders, NO_RESULTS_FILTER, resultWaves, type ResultsFilterState } from "./results/resultFilterRules";
import resultStyles from "./results/results.module.css";
import { rankRiders } from "./results/officialOrder";
import { BroadcastView, enterFullscreen } from "./broadcast/BroadcastView";

type Rider = PublicRider;
const TABS: { key: ShareTab; label: string }[] = [
  { key: "race", label: "Race" },
  { key: "results", label: "Results" },
  { key: "live", label: "Live" },
];

const OUT = ["DNF", "DSQ", "DNS"];
const isOut = (r: Rider) => OUT.includes(String(r.status));
const catKey = (name?: string | null, sub?: string | null) => `${name ?? ""}::${sub ?? ""}`;
const fullName = (r: Rider) => [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" ");
const catLabel = (c: Pick<SharedCategory, "name" | "subCategory">) => (c.subCategory ? `${c.name} ${c.subCategory}` : c.name);
const started = (c: SharedCategory) => c.status === "running" || c.startedAt != null;

// rankRiders (the RESULTS order) lives in results/officialOrder.ts, shared with the TV broadcast.

type CatState = "upcoming" | "running" | "finished";
function categoryState(c: SharedCategory): CatState {
  if (c.status === "running") return "running";
  if (c.status === "finished" && c.startedAt != null) return "finished";
  return "upcoming";
}

/** NOT STARTED / STANDING (waiting in a started category) / RUNNING / FINISHED, or DNF/DSQ/DNS. */
function riderStatus(r: Rider, cat: CatState): string {
  if (isOut(r)) return String(r.status);
  if (r.raceStatus === "finished" || r.status === "finished") return STATUS_LABEL.finished;
  if (r.raceStatus === "running") return STATUS_LABEL.running;
  return cat === "upcoming" ? STATUS_LABEL.upcoming : STATUS_LABEL.standing;
}

/** Remount per race: another race opened from Other Bike Races starts clean. */
export default function SharePage() {
  const { token = "" } = useParams();
  return <SpectatorRace key={token} token={token} />;
}

function SpectatorRace({ token }: { token: string }) {
  const [params, setParams] = useSearchParams();
  const tab = shareTabFromParam(params.get("tab"));
  const tv = params.get("view") === "tv";
  const feed = usePublicRaceFeed(token, { liveTab: tab === "live" });
  const { race, categories, riders, error, offline, updatedAt, refreshing, live } = feed;
  // 2.0: a tab change is a history entry, so Back/Forward move between tabs.
  const setParam = (key: string, value: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (value == null) n.delete(key);
      else n.set(key, value);
      return n;
    });
  const selectTab = (t: ShareTab) => setParam("tab", t);
  const openTv = () => {
    enterFullscreen(); // needs this click (user gesture)
    setParam("view", "tv");
  };

  // Other Bike Races: remember this public race in this browser only.
  const [others, setOthers] = useState<OtherRace[]>([]);
  useEffect(() => {
    if (!race?.name) return;
    rememberOtherRace({ token, name: race.name, date: race.date ?? null, location: race.location ?? null });
    setOthers(listOtherRaces().filter((o) => o.token !== token));
  }, [token, race?.name, race?.date, race?.location]);

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
      [...categories].sort(
        (a, b) => (a.heat ?? 999) - (b.heat ?? 999) || String(a.startTime ?? "").localeCompare(String(b.startTime ?? "")) || (a.importOrder ?? 0) - (b.importOrder ?? 0) || a.name.localeCompare(b.name),
      ),
    [categories],
  );

  // 2.0 shared model for RACE / LIVE / TV: waves from category.heat, categories by key.
  const waves = useMemo(() => summarizeWaves(sortedCats, ridersByCategory(riders.values())), [sortedCats, riders]);
  const categoriesByKey = useMemo(() => new Map(sortedCats.map((c) => [waveCategoryKey(c.name, c.subCategory), c])), [sortedCats]);
  const now = useTicker(5_000, tab === "live" || tv);
  const freshness = feedFreshness({ offline, updatedAt, delayMs: feed.delayMs, raceFinished: race?.status === "finished", now });

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
  if (tv) {
    return (
      <BroadcastView
        race={race}
        tab={tab}
        waves={waves}
        categories={sortedCats}
        ridersByCat={ridersByCat}
        categoriesByKey={categoriesByKey}
        approvals={feed.approvals}
        clockOffsetMs={feed.clockOffsetMs}
        freshness={freshness}
        updatedAt={updatedAt}
        onSelectTab={selectTab}
        onExit={() => setParam("view", null)}
      />
    );
  }
  const liveLabel = finished ? "Race finished" : live ? (offline ? "Reconnecting…" : "Live") : "Live updates ended";

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
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={() => feed.refresh()}
            disabled={refreshing}
            aria-label="Refresh"
            title="Refresh"
            data-testid="share-refresh"
          >
            <RefreshCw size={14} className={refreshing ? styles.spin : undefined} aria-hidden="true" />
          </button>
          <button type="button" className={`${styles.refreshBtn} ${liveStyles.tvBtn}`} onClick={openTv} aria-label="TV broadcast mode" title="TV broadcast mode" data-testid="share-tv">
            <Tv size={14} aria-hidden="true" />
          </button>
        </div>
      </header>

      <nav className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? styles.tabOn : styles.tab} onClick={() => selectTab(t.key)} data-testid={`share-tab-${t.key}`}>
            {t.key === "live" && waves.some((w) => w.state === "running") && <span className={liveStyles.tabLiveDot} aria-label="wave running" />}
            {t.label}
          </button>
        ))}
      </nav>

      <main className={`${styles.content} ${tab === "live" ? liveStyles.wideContent : ""}`}>
        <div className={styles.stack}>
          {tab === "results" ? (
            <ResultsTab categories={sortedCats} ridersByCat={ridersByCat} approvals={feed.approvals} raceFinished={finished} onOpenLive={() => selectTab("live")} />
          ) : tab === "live" ? (
            <LiveTab
              waves={waves}
              categoriesByKey={categoriesByKey}
              clockOffsetMs={feed.clockOffsetMs}
              freshness={freshness}
              updatedAt={updatedAt}
              raceFinished={finished}
              onOpenResults={() => selectTab("results")}
            />
          ) : (
            <>
              <ActiveWaveStrip waves={waves} clockOffsetMs={feed.clockOffsetMs} raceFinished={finished} onOpenLive={() => selectTab("live")} />
              <RaceTab categories={sortedCats} ridersByCat={ridersByCat} />
            </>
          )}
          {others.length > 0 && <OtherRaces races={others} />}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

const Swatch = ({ color }: { color: string | null }) => <span className={styles.swatch} style={{ background: color ?? "var(--border-card)" }} aria-hidden="true" />;
const StateChip = ({ state }: { state: CatState }) => (
  <span className={styles.stateChip} data-state={state}>{STATUS_LABEL[state]}</span>
);

function ResultsTab({
  categories,
  ridersByCat,
  approvals,
  raceFinished,
  onOpenLive,
}: {
  categories: SharedCategory[];
  ridersByCat: Map<string, Rider[]>;
  approvals: Map<string, CategoryApprovalView>;
  raceFinished: boolean;
  onOpenLive: () => void;
}) {
  const withRiders = categories.filter((c) => (ridersByCat.get(catKey(c.name, c.subCategory)) ?? []).length > 0);
  const [filter, setFilter] = useState("");
  const [podium, setPodium] = useState(false);
  const [podiumSize, setPodiumSize] = useState<Record<string, 3 | 5>>({});
  const [openRider, setOpenRider] = useState<string | null>(null);
  const [rf, setRf] = useState<ResultsFilterState>(NO_RESULTS_FILTER);

  // 2.0: RESULTS is official only — nothing before the race is officially finished (Finish Race).
  if (!raceFinished) return <ResultsPending onOpenLive={onOpenLive} />;
  if (withRiders.length === 0) return <p className={styles.empty}>No results yet.</p>;
  const visible = filterResultCategories(withRiders, ridersByCat, rf);
  const shown = filter && visible.some((c) => c.uuid === filter) ? visible.filter((c) => c.uuid === filter) : visible;

  return (
    <>
      <ResultsFilters value={rf} waves={resultWaves(withRiders)} onChange={setRf} />
      <div className={styles.toolbar}>
        {visible.length > 1 && (
          <select className={styles.catFilter} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Category" data-testid="share-category-filter">
            <option value="">All categories</option>
            {visible.map((c) => (
              <option key={c.uuid} value={c.uuid}>{catLabel(c)}</option>
            ))}
          </select>
        )}
        <button type="button" className={`${styles.podiumToggle} ${podium ? styles.podiumToggleOn : ""}`} onClick={() => setPodium((v) => !v)} aria-pressed={podium} data-testid="share-podium-toggle">
          <Trophy size={15} aria-hidden="true" /> Podium
        </button>
      </div>

      {shown.length === 0 && <p className={styles.empty} data-testid="share-results-none">No riders match these filters.</p>}
      {shown.map((c) => {
        const state = categoryState(c);
        const all = rankRiders(ridersByCat.get(catKey(c.name, c.subCategory)) ?? []);
        const size = podiumSize[c.uuid] ?? 3;
        const approval = approvals.get(c.uuid);
        // The podium is published only once the category is APPROVED (0.3.5); rankings stay visible.
        const showPodium = podium && !!approval;
        // Filters hide rows only, after the official selection (podium eligibility unchanged).
        const list = filterResultRiders(podium ? (approval ? all.filter((r) => !isOut(r) && r.position_category).slice(0, size) : []) : all, rf);
        const field = all.map(asBreakdownRider);
        return (
          <section key={c.uuid} className={styles.card} data-testid="share-results-category">
            <h2 className={styles.cardTitle}>
              <Swatch color={c.color} /> <span dir="auto">{catLabel(c)}</span>
              <span className={styles.titleChips}>
                <StateChip state={state} />
                {approval ? (
                  <span className={styles.approved} title={`Approved ${new Date(approval.approvedAt).toLocaleString()}`} data-testid="share-approved">
                    <BadgeCheck size={12} aria-hidden="true" /> Approved
                  </span>
                ) : (
                  started(c) && <span className={styles.provisional} title="Results are provisional until approved by the judges" data-testid="share-provisional">Provisional</span>
                )}
              </span>
            </h2>
            {podium && !approval && (
              <p className={styles.emptySmall} data-testid="share-podium-pending">The podium is shown once the judges approve this category's results.</p>
            )}
            {showPodium && (
              <div className={styles.podiumBar}>
                <span>Top {size}</span>
                <button type="button" className={styles.linkBtn} onClick={() => setPodiumSize((m) => ({ ...m, [c.uuid]: size === 5 ? 3 : 5 }))} data-testid="share-podium-size">
                  {size === 5 ? "Show top 3" : "Show top 5"}
                </button>
              </div>
            )}
            {showPodium && list.length === 0 && <p className={styles.emptySmall}>No classified riders yet.</p>}
            <ol className={styles.list}>
              {list.map((r, i) => {
                const out = isOut(r);
                const openId = `${c.uuid}:${r.uuid}`;
                const open = openRider === openId;
                const medal = showPodium && i < 3 ? [styles.rowGold, styles.rowSilver, styles.rowBronze][i] : "";
                return (
                  <Fragment key={r.uuid}>
                    <li className={`${styles.resultItem} ${medal}`}>
                      <button type="button" className={styles.resultRow} onClick={() => setOpenRider(open ? null : openId)} aria-expanded={open} data-testid="share-rider-row">
                        <span className={styles.place}>{out ? "–" : r.position_category ?? "–"}</span>
                        <span className={styles.bib}>{r.bibNumber ?? "—"}</span>
                        <span className={styles.riderMain}>
                          <span className={styles.name} dir="auto">{fullName(r)}</span>
                          <span className={styles.sub} dir="auto">{[r.team, `${r.lapsCounter ?? 0}${c.laps ? `/${c.laps}` : ""} laps`].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span className={styles.time}>
                          {out ? <span className={styles.outChip}>{r.status}</span> : r.elapsedTimeFromStart || <span className={styles.statusText}>{riderStatus(r, state)}</span>}
                        </span>
                        <ChevronDown size={16} className={`${styles.chev} ${open ? styles.chevOpen : ""}`} aria-hidden="true" />
                      </button>
                    </li>
                    {open && (
                      <li className={styles.details} data-testid="share-rider-details">
                        <p className={styles.detailStatus}>{riderStatus(r, state)}</p>
                        <RiderLapTable rider={asBreakdownRider(r)} field={field} />
                      </li>
                    )}
                  </Fragment>
                );
              })}
            </ol>
          </section>
        );
      })}
    </>
  );
}

function ResultsPending({ onOpenLive }: { onOpenLive: () => void }) {
  return (
    <section className={resultStyles.pending} data-testid="share-results-pending">
      <span className={resultStyles.pendingIcon} aria-hidden="true"><Trophy size={26} /></span>
      <h2>Race in progress</h2>
      <p>Results are published here once the race is officially finished. Follow the provisional standings on LIVE.</p>
      <button type="button" className={resultStyles.followLive} onClick={onOpenLive} data-testid="share-follow-live">
        Follow LIVE standings
      </button>
    </section>
  );
}

/** The lap breakdown (shared with the app's Results) keys riders by `id`; public riders have only `uuid`. */
function asBreakdownRider(r: Rider): RiderProps {
  return { ...r, id: r.uuid, status: r.status ?? "standing", lapsCounter: r.lapsCounter ?? 0, lapsDetails: r.lapsDetails ?? [] } as unknown as RiderProps;
}

function RaceTab({ categories, ridersByCat }: { categories: SharedCategory[]; ridersByCat: Map<string, Rider[]> }) {
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
    <>
      {waves.map(([wave, cats]) => {
        const starts = cats.map((c) => c.startTime).filter(Boolean).sort();
        const states = cats.map(categoryState);
        const waveState: CatState = states.includes("running") ? "running" : states.every((s) => s === "finished") ? "finished" : "upcoming";
        return (
          <section key={wave} className={styles.card} data-wave-state={waveState} data-testid="share-wave">
            <h2 className={styles.cardTitle}>
              {wave === "—" ? "Not scheduled" : `Wave ${wave}`}
              {starts[0] && <span className={styles.cardTitleSide}><Clock size={14} /> {starts[0]}</span>}
              <span className={styles.titleChips}><StateChip state={waveState} /></span>
            </h2>
            <ul className={styles.list}>
              {cats.map((c) => {
                const list = ridersByCat.get(catKey(c.name, c.subCategory)) ?? [];
                const done = list.filter((r) => !isOut(r) && (r.raceStatus === "finished" || r.status === "finished")).length;
                const onCourse = list.filter((r) => r.raceStatus === "running" && !isOut(r)).length;
                const state = categoryState(c);
                const progress = state === "upcoming" ? null : `${done} finished${onCourse ? ` · ${onCourse} on course` : ""}`;
                return (
                  <li key={c.uuid} className={styles.catRow}>
                    <Swatch color={c.color} />
                    <span className={styles.riderMain}>
                      <span className={styles.name} dir="auto">{catLabel(c)}</span>
                      <span className={styles.sub}>
                        {[c.startTime ? `Start ${c.startTime}` : null, c.laps ? `${c.laps} lap${c.laps === 1 ? "" : "s"}` : null, `${list.length} rider${list.length === 1 ? "" : "s"}`, progress].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <StateChip state={state} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function OtherRaces({ races }: { races: OtherRace[] }) {
  return (
    <section className={styles.card} data-testid="share-other-races">
      <h2 className={styles.cardTitle}>Other Bike Races</h2>
      <ul className={styles.list}>
        {races.map((o) => (
          <li key={o.token}>
            <Link to={`/share/${o.token}`} className={styles.otherRace}>
              <span className={styles.name} dir="auto">{o.name}</span>
              <span className={styles.sub} dir="auto">{[o.date, o.location].filter(Boolean).join(" · ")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
