import React, { useEffect, useState } from "react";
import styles from "./checkIn.module.css";
import { CategoryProps, RiderProps } from "@/types/types";
import useRiderStore from "@/stores/ridersStore";
import useUIStore from "@/stores/uiStore";
import StatusModal from "../../components/modals/StatusModal";
import Icons from "@/constants/Icons";
import { recordRaceEvent } from "@/services/cloud/raceEvents";
import { canForRace } from "@/services/cloud/permissions";
import { riderInCategory } from "../schedule/Schedule";

interface Props {
  raceUuid: string;
  waveNum: number;
  categories: CategoryProps[];
  /** Start slots of this wave (startTime → categories). Each becomes a bordered block. */
  slots?: Map<string, CategoryProps[]>;
}

type SortKey = "standing" | "bib" | "name" | "first";

/** Sort choice survives tab switches for this working session. */
const SORT_SESSION_KEY = "commissaire.checkinSort";
const loadSort = (): SortKey => {
  try {
    const v = sessionStorage.getItem(SORT_SESSION_KEY);
    return v === "bib" || v === "name" || v === "first" ? v : "standing";
  } catch {
    return "standing";
  }
};

const catKey = (c: CategoryProps) => `${c.name}::${c.subCategory ?? ""}`;
const standingOf = (r: RiderProps): number | null => r.standing ?? r.position_start ?? null;

const CheckIn: React.FC<Props> = ({ raceUuid, waveNum, categories, slots }) => {
  const { riders, getRiders, updateRider, patchRiders } = useRiderStore();
  const { openModal } = useUIStore();
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [selectedRider, setSelectedRider] = useState<RiderProps | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "cards">("list");
  const [sortKey, setSortKeyState] = useState<SortKey>(loadSort);
  const setSortKey = (k: SortKey) => {
    setSortKeyState(k);
    try { sessionStorage.setItem(SORT_SESSION_KEY, k); } catch { /* preference only */ }
  };
  const [toolsOpen, setToolsOpen] = useState(false);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [sortScope, setSortScope] = useState<"category" | "wave">("category");
  const [editingBibId, setEditingBibId] = useState<number | null>(null);
  const [bibDraft, setBibDraft] = useState("");
  const [bibError, setBibError] = useState("");
  const [savedBibId, setSavedBibId] = useState<number | null>(null);

  useEffect(() => { getRiders(raceUuid); }, [raceUuid, getRiders]);

  const slotList: [string, CategoryProps[]][] = slots && slots.size > 0
    ? [...slots.entries()]
    : [["", categories]];

  const waveRiders = riders.filter(
    (r) => r.raceUuid === raceUuid && categories.some((c) => riderInCategory(r, c))
  );

  const q = search.trim().toLowerCase();
  const filtered = waveRiders.filter((r) => {
    if (filterCat !== "all" && r.category !== filterCat) return false;
    return (
      !q ||
      r.firstName.toLowerCase().includes(q) ||
      r.lastName.toLowerCase().includes(q) ||
      String(r.bibNumber).includes(q)
    );
  });

  const compare = (a: RiderProps, b: RiderProps) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortKey === "first") {
      const n = a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName);
      return n * dir;
    }
    if (sortKey === "name") {
      const n = a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
      return n * dir;
    }
    if (sortKey === "bib") return (a.bibNumber - b.bibNumber) * dir;
    // standing: riders with no standing always go last; fall back to bib
    const sa = standingOf(a);
    const sb = standingOf(b);
    if (sa == null && sb == null) return a.bibNumber - b.bibNumber;
    if (sa == null) return 1;
    if (sb == null) return -1;
    return (sa - sb) * dir || a.bibNumber - b.bibNumber;
  };

  const catColorOfRider = (rider: RiderProps) =>
    rider.color ??
    categories.find(
      (c) => c.name === rider.category && (c.subCategory ?? null) === (rider.subCategory ?? null)
    )?.color ??
    "#63a6fc";

  const catNames = [...new Set(waveRiders.map((r) => r.category))].sort();

  const recordCheckin = (rider: RiderProps, checked: boolean) =>
    recordRaceEvent({
      raceUuid,
      riderId: rider.id,
      bibNumber: rider.bibNumber,
      eventType: "RIDER_CHECKIN",
      payload: { riderLocalId: rider.id, riderPatch: { checked } },
    });

  const isRaceActive = categories.some(
    (c) => c.status === "running" || c.status === "finished"
  );

  const toggleCheck = (rider: RiderProps) => {
    if (!canForRace(raceUuid, "CHECKIN_RIDER")) return;
    const checking = !rider.checked;
    updateRider({
      ...rider,
      checked: checking,
      ...(checking && rider.status === "DNS" ? { status: "standing" as const } : {}),
    });
    void recordCheckin(rider, checking);
  };

  /**
   * Check in every rider currently shown, in a SINGLE store write.
   *
   * This used to loop `updateRider` + `recordRaceEvent` per rider, which meant
   * three IndexedDB round-trips each (rider write, `persist` re-writing the
   * whole array, event write). On a real start list that froze the screen and
   * a stale in-flight `getRiders` could land mid-flood and revert the ticks.
   * Keep it batched: one `patchRiders`, then drain the event log serially in
   * the background so it never competes with the UI write.
   */
  const checkAll = async () => {
    if (!canForRace(raceUuid, "CHECKIN_RIDER")) return;
    const unchecked = filtered.filter((r) => !r.checked && !["DNS", "DNF", "DSQ"].includes(r.status));
    if (unchecked.length === 0) return;

    const checkedIn = unchecked.map((r) => ({ ...r, checked: true }));
    await patchRiders(checkedIn);

    void (async () => {
      for (const r of checkedIn) {
        try {
          await recordCheckin(r, true);
        } catch (e) {
          console.warn("Check-in event not logged for bib", r.bibNumber, e);
        }
      }
    })();
  };

  const allAccountedFor = filtered.length > 0 && filtered.every(
    (r) => r.checked || ["DNS", "DNF", "DSQ"].includes(r.status)
  );

  const handleStatusChange = (status: any) => {
    if (selectedRider) updateRider({ ...selectedRider, status });
  };

  /**
   * One-tap DNS straight from the row (BUGS.md #25). Toggles back to "standing"
   * so it's undoable, and writes the same field the Status menu does.
   */
  const toggleDns = (rider: RiderProps) => {
    if (!canForRace(raceUuid, "MARK_DNS")) return;
    const nowDns = rider.status !== "DNS";
    updateRider({
      ...rider,
      status: nowDns ? "DNS" : "standing",
      // A DNS rider never takes the line, so they can't stay checked in.
      checked: nowDns ? false : rider.checked,
    });
  };

  // ── Edit bib ──
  const startEditBib = (rider: RiderProps) => {
    setEditingBibId(rider.id);
    setBibDraft(String(rider.bibNumber));
    setBibError("");
  };

  const cancelEditBib = () => {
    setEditingBibId(null);
    setBibError("");
  };

  const saveBib = async (rider: RiderProps) => {
    if (!canForRace(raceUuid, "CHECKIN_RIDER")) return;
    const bib = Number(bibDraft);
    if (!bibDraft.trim() || !Number.isInteger(bib) || bib <= 0) {
      setBibError("Enter a valid bib number");
      return;
    }
    if (bib === rider.bibNumber) {
      cancelEditBib();
      return;
    }
    const clash = riders.find((r) => r.raceUuid === raceUuid && r.id !== rider.id && r.bibNumber === bib);
    if (clash) {
      setBibError(`Bib ${bib} is already used by ${clash.lastName} ${clash.firstName}`);
      return;
    }
    await updateRider({ ...rider, bibNumber: bib });
    void recordRaceEvent({
      raceUuid,
      riderId: rider.id,
      bibNumber: bib,
      eventType: "RIDER_EDITED",
      payload: { riderLocalId: rider.id, riderPatch: { bibNumber: bib }, previousBib: rider.bibNumber },
    });
    setEditingBibId(null);
    setBibError("");
    setSavedBibId(rider.id);
    setTimeout(() => setSavedBibId((id) => (id === rider.id ? null : id)), 2500);
  };

  const renderBib = (rider: RiderProps, card = false) => {
    if (editingBibId === rider.id) {
      return (
        <span className={styles.bibEdit}>
          <input
            className={styles.bibInput}
            type="number"
            inputMode="numeric"
            autoFocus
            value={bibDraft}
            data-testid={`checkin-bibinput-${rider.bibNumber}`}
            onChange={(e) => { setBibDraft(e.target.value); setBibError(""); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveBib(rider);
              if (e.key === "Escape") cancelEditBib();
            }}
          />
          <button className={styles.bibSave} onClick={() => void saveBib(rider)} title="Save bib" aria-label="Save bib">✓</button>
          <button className={styles.bibCancel} onClick={cancelEditBib} title="Cancel" aria-label="Cancel">✕</button>
          {bibError && <span className={styles.bibError}>{bibError}</span>}
        </span>
      );
    }
    return (
      <span className={styles.bibWrap}>
        {!card && <span className={styles.bib}>{rider.bibNumber}</span>}
        {savedBibId === rider.id && <span className={styles.bibSaved}>✓ Saved</span>}
        {!isRaceActive && (
          <button
            className={styles.bibEditBtn}
            onClick={() => startEditBib(rider)}
            title="Edit bib number"
            aria-label={`Edit bib ${rider.bibNumber}`}
            data-testid={`checkin-editbib-${rider.bibNumber}`}
          >✎</button>
        )}
      </span>
    );
  };

  const renderRow = (rider: RiderProps, showCat = false) => {
    const hasStatus = ["DNS", "DNF", "DSQ"].includes(rider.status);
    const statusClass = rider.status === "DNS"
      ? styles.dnsBadge
      : rider.status === "DNF"
      ? styles.dnfBadge
      : rider.status === "DSQ"
      ? styles.dsqBadge
      : "";
    const st = standingOf(rider);
    return (
      <div
        key={rider.id}
        data-testid={`checkin-row-${rider.bibNumber}`}
        data-checked={rider.checked ? "yes" : "no"}
        data-status={rider.status}
        data-standing={st ?? ""}
        className={`${styles.row} ${rider.checked ? styles.checked : ""} ${hasStatus ? styles.out : ""}`}
      >
        <span className={styles.rowColorBar} style={{ background: catColorOfRider(rider) }} title={rider.category} />
        {renderBib(rider)}
        <span className={styles.who}>
          <span className={styles.name} dir="auto">{rider.lastName} {rider.firstName}</span>
          {showCat && <span className={styles.cat} dir="auto">{rider.category}</span>}
        </span>
        <div className={styles.rowActions}>
          {isRaceActive && !hasStatus ? (
            <span className={`${styles.actState} ${rider.checked ? styles.actIn : ""}`} title="Check-in locked">
              {rider.checked ? "✓ In" : "—"}
            </span>
          ) : hasStatus && (rider.status !== "DNS" || isRaceActive) ? (
            <button
              className={`${styles.statusInlineBadge} ${statusClass}`}
              onClick={() => { setSelectedRider(rider); openModal("modalStatus"); }}
              title="Change status"
            >
              {rider.status}
            </button>
          ) : (
            <>
              <button
                className={`${styles.actBtn} ${rider.checked ? styles.actIn : ""}`}
                onClick={() => toggleCheck(rider)}
                aria-pressed={!!rider.checked}
                data-testid={`checkin-check-${rider.bibNumber}`}
                title={rider.checked ? "Undo check-in" : "Check in"}
              >
                {rider.checked ? "✓ In" : "Check In"}
              </button>
              <button
                className={`${styles.actBtn} ${rider.status === "DNS" ? styles.actDns : ""}`}
                onClick={() => toggleDns(rider)}
                aria-pressed={rider.status === "DNS"}
                aria-label={`Mark #${rider.bibNumber} DNS`}
                title={rider.status === "DNS" ? "Undo DNS" : "Did not start"}
              >
                DNS
              </button>
            </>
          )}
          <button
            className={styles.moreBtn}
            onClick={() => { setSelectedRider(rider); openModal("modalStatus"); }}
            aria-label={`Status for #${rider.bibNumber}`}
            title="Other status (DNF, DSQ…)"
          >⋯</button>
        </div>
      </div>
    );
  };

  const renderCard = (rider: RiderProps) => {
    const hasStatus = ["DNS", "DNF", "DSQ"].includes(rider.status);
    const isChecked = rider.checked;
    const catColor = catColorOfRider(rider);
    const st = standingOf(rider);
    const tileBg = isChecked
      ? `linear-gradient(160deg, #3edda4, #2fcf95)`
      : hasStatus
      ? "#d0d8ea"
      : catColor;
    return (
      <div key={rider.id} className={`${styles.checkTile} ${hasStatus ? styles.checkTileOut : ""}`}>
        <span className={styles.tileCatStrip} style={{ background: catColor }} title={rider.category} />
        <div className={styles.checkTileInner} style={{ background: tileBg }}>
          <button
            className={styles.tileStatusTrigger}
            onClick={() => { setSelectedRider(rider); openModal("modalStatus"); }}
            title="Change status"
          >⋯</button>
          {isChecked && !hasStatus && <div className={styles.checkMark}>✓</div>}
          <div className={styles.checkTileBib}>{rider.bibNumber}</div>
          <div className={styles.tileStanding}>S{st ?? "–"}</div>
          {hasStatus && <div className={styles.tileStatusBadge}>{rider.status}</div>}
          {renderBib(rider, true)}
        </div>
        <button
          className={styles.checkTileBtn}
          onClick={() => { if (!isRaceActive && !hasStatus) toggleCheck(rider); }}
          disabled={isRaceActive || hasStatus}
        >
          {isChecked ? "✓ Go Live" : "Go Live"}
        </button>
      </div>
    );
  };

  const renderRiders = (list: RiderProps[], showCat = false) =>
    viewMode === "list" ? (
      <div className={styles.list}>{list.map((r) => renderRow(r, showCat))}</div>
    ) : (
      <div className={styles.cardGrid}>{list.map(renderCard)}</div>
    );

  // Riders are added and managed in CREATE > Riders, not here.

  const renderCategoryBlock = (cat: CategoryProps) => {
    const key = catKey(cat);
    const all = waveRiders.filter((r) => riderInCategory(r, cat));
    const shown = filtered.filter((r) => riderInCategory(r, cat)).sort(compare);
    const dns = all.filter((r) => r.status === "DNS").length;
    return (
      <div key={key} className={styles.catBlock} style={{ borderColor: cat.color ?? "#d5e4fb" }}>
        <div className={styles.catBlockHeader}>
          <span className={styles.catGroupBar} style={{ background: cat.color ?? "#63a6fc" }} />
          <span className={styles.catGroupName} dir="auto">{cat.name}{cat.subCategory ? ` · ${cat.subCategory}` : ""}</span>
          <span className={styles.catGroupCount}>✓ {all.filter((r) => r.checked).length}/{all.length}</span>
          {dns > 0 && <span className={styles.catDnsCount}>{dns} DNS</span>}
        </div>
        {shown.length > 0 ? (
          renderRiders(shown)
        ) : (
          <div className={styles.emptyCat}>{all.length === 0 ? "No riders yet" : "No riders match"}</div>
        )}
      </div>
    );
  };

  const renderSlot = ([time, cats]: [string, CategoryProps[]]) => {
    const visibleCats = cats.filter((c) => filterCat === "all" || c.name === filterCat);
    const slotRiders = waveRiders.filter((r) => cats.some((c) => riderInCategory(r, c)));
    const slotChecked = slotRiders.filter((r) => r.checked).length;
    return (
      <section key={time || "all"} className={styles.waveBlock} data-testid={`checkin-wave-${waveNum}-${time}`}>
        <header className={styles.waveHeader}>
          <span className={styles.waveTitle}>
            Wave {waveNum}{time && time !== "TBD" ? ` · ${time}` : ""}
          </span>
          <span className={styles.waveCount}>✓ {slotChecked}/{slotRiders.length}</span>
        </header>
        {sortScope === "category" ? (
          <div className={styles.waveBody}>{visibleCats.map(renderCategoryBlock)}</div>
        ) : (
          <div className={styles.waveBody}>
            {renderRiders(
              filtered.filter((r) => visibleCats.some((c) => riderInCategory(r, c))).sort(compare),
              true
            )}
          </div>
        )}
      </section>
    );
  };

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "standing", label: "Start pos." },
    { key: "bib", label: "Bib" },
    { key: "name", label: "Last name" },
    { key: "first", label: "First name" },
  ];

  return (
    <div className={styles.container}>
      {isRaceActive && (
        <div className={styles.raceLockBanner}>
          🏁 Race in progress — check-in locked. You can still change rider status.
        </div>
      )}
      {waveRiders.length > 0 && (
        <div className={styles.stickyBar}>
          <div className={styles.topLine}>
            <div className={styles.counts}>
              <span className={styles.countItem}><b>{waveRiders.length}</b> total</span>
              <span className={`${styles.countItem} ${styles.countIn}`}><b>{waveRiders.filter((r) => r.checked).length}</b> in</span>
              <span className={styles.countItem}>
                <b>{waveRiders.filter((r) => !r.checked && !["DNS", "DNF", "DSQ"].includes(r.status)).length}</b> left
              </span>
              {waveRiders.some((r) => r.status === "DNS") && (
                <span className={`${styles.countItem} ${styles.countDns}`} data-testid="checkin-dns-count"><b>{waveRiders.filter((r) => r.status === "DNS").length}</b> DNS</span>
              )}
            </div>
            <button
              className={`${styles.toolsBtn} ${toolsOpen || search ? styles.toolsBtnActive : ""}`}
              onClick={() => setToolsOpen((o) => !o)}
              aria-expanded={toolsOpen}
              data-testid="checkin-tools"
            >
              <img src={Icons.search} alt="" width={14} height={14} />
              {search ? `“${search}”` : sortOptions.find((o) => o.key === sortKey)?.label}
            </button>
          </div>

          {toolsOpen && (
            <div className={styles.toolsPanel}>
              <div className={styles.searchWrap}>
                <input
                  className={styles.search}
                  dir="auto"
                  autoFocus
                  placeholder="Search name or bib"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape" || e.key === "Enter") setToolsOpen(false); }}
                />
                {search && <button className={styles.clearBtn} onClick={() => setSearch("")} aria-label="Clear search">✕</button>}
              </div>
              <div className={styles.panelRow}>
                <span className={styles.sortLabel}>Sort</span>
                <div className={styles.scopeToggle}>
                  {sortOptions.map((o) => (
                    <button
                      key={o.key}
                      className={`${styles.scopeBtn} ${sortKey === o.key ? styles.scopeBtnActive : ""}`}
                      aria-pressed={sortKey === o.key}
                      onClick={() => setSortKey(o.key)}
                    >{o.label}</button>
                  ))}
                </div>
                <button
                  className={styles.dirBtn}
                  onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                  title={sortDir === "asc" ? "Ascending" : "Descending"}
                  aria-label={sortDir === "asc" ? "Ascending" : "Descending"}
                >{sortDir === "asc" ? "▲" : "▼"}</button>
              </div>
              <div className={styles.panelRow}>
                <select className={styles.catSelect} value={filterCat} onChange={(e) => setFilterCat(e.target.value)} aria-label="Category filter">
                  <option value="all">All categories</option>
                  {catNames.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className={styles.scopeToggle}>
                  <button className={`${styles.scopeBtn} ${sortScope === "category" ? styles.scopeBtnActive : ""}`} onClick={() => setSortScope("category")}>By category</button>
                  <button className={`${styles.scopeBtn} ${sortScope === "wave" ? styles.scopeBtnActive : ""}`} onClick={() => setSortScope("wave")}>Whole wave</button>
                </div>
                <div className={styles.viewToggle}>
                  <button className={`${styles.viewBtn} ${viewMode === "list" ? styles.viewBtnActive : ""}`} onClick={() => setViewMode("list")} title="List view">☰</button>
                  <button className={`${styles.viewBtn} ${viewMode === "cards" ? styles.viewBtnActive : ""}`} onClick={() => setViewMode("cards")} title="Card view">⊞</button>
                </div>
                {!allAccountedFor && !isRaceActive && (
                  <button className={styles.scopeBtn} onClick={checkAll}>Check All</button>
                )}
                <button className={styles.doneBtn} onClick={() => setToolsOpen(false)}>Done</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* No riders yet: no toolbar or counts, just each category with its Add button */}
      <div className={styles.groupWrap}>{slotList.map(renderSlot)}</div>

      {selectedRider && <StatusModal rider={selectedRider} onStatusChange={handleStatusChange} />}
    </div>
  );
};

export default CheckIn;
