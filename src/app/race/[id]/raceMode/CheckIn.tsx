import React, { useEffect, useState } from "react";
import styles from "./checkIn.module.css";
import { CategoryProps, RiderProps } from "@/types/types";
import useRiderStore from "@/stores/ridersStore";
import useUIStore from "@/stores/uiStore";
import StatusModal from "../../components/modals/StatusModal";
import QuickAddRider from "./QuickAddRider";
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

type SortKey = "standing" | "bib" | "name";

const catKey = (c: CategoryProps) => `${c.name}::${c.subCategory ?? ""}`;
const standingOf = (r: RiderProps): number | null => r.standing ?? r.position_start ?? null;

const CheckIn: React.FC<Props> = ({ raceUuid, waveNum, categories, slots }) => {
  const { riders, getRiders, updateRider, patchRiders } = useRiderStore();
  const { openModal } = useUIStore();
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [selectedRider, setSelectedRider] = useState<RiderProps | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "cards">("list");
  const [sortKey, setSortKey] = useState<SortKey>("standing");
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
    updateRider({ ...rider, checked: !rider.checked });
    void recordCheckin(rider, !rider.checked);
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
        {!card && <span className={styles.bib}>#{rider.bibNumber}</span>}
        {savedBibId === rider.id && <span className={styles.bibSaved}>✓ Saved</span>}
        {!isRaceActive && (
          <button
            className={styles.bibEditBtn}
            onClick={() => startEditBib(rider)}
            title="Edit bib number"
            aria-label={`Edit bib ${rider.bibNumber}`}
            data-testid={`checkin-editbib-${rider.bibNumber}`}
          >✎ Bib</button>
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
        className={`${styles.row} ${rider.checked ? styles.checked : ""} ${hasStatus ? styles.out : ""}`}
      >
        <span className={styles.rowColorBar} style={{ background: catColorOfRider(rider) }} title={rider.category} />
        <div className={styles.leftArea}>
          {hasStatus ? (
            <button
              className={`${styles.statusInlineBadge} ${statusClass}`}
              onClick={() => { setSelectedRider(rider); openModal("modalStatus"); }}
              title="Tap to change status"
            >
              {rider.status}
            </button>
          ) : isRaceActive ? (
            <>
              <span className={`${styles.checkBtn} ${rider.checked ? styles.checkedBtn : styles.lockedBtn}`} title="Check-in locked" />
              <button className={styles.statusTrigger} onClick={() => { setSelectedRider(rider); openModal("modalStatus"); }}>Status</button>
            </>
          ) : (
            <>
              <button
                className={`${styles.checkBtn} ${rider.checked ? styles.checkedBtn : ""}`}
                onClick={() => toggleCheck(rider)}
                title={rider.checked ? "Uncheck" : "Check in"}
              />
              <button
                className={styles.dnsTrigger}
                onClick={() => toggleDns(rider)}
                title="Mark as DNS (did not start)"
                aria-label={`Mark #${rider.bibNumber} DNS`}
              >
                DNS
              </button>
              <button className={styles.statusTrigger} onClick={() => { setSelectedRider(rider); openModal("modalStatus"); }}>Status</button>
            </>
          )}
        </div>
        <span className={styles.standingNum} title="Standing (rank)">
          {st != null ? `S${st}` : "S–"}
        </span>
        {renderBib(rider)}
        <span className={styles.name} dir="auto">{rider.lastName} {rider.firstName}</span>
        {showCat && (
          <span className={styles.cat}>
            <span className={styles.catDot} style={{ background: catColorOfRider(rider) }} />
            {rider.category}
          </span>
        )}
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

  const renderAddForm = (key: string, cat: CategoryProps) =>
    addingFor === key ? (
      <QuickAddRider
        raceUuid={raceUuid}
        waveNum={waveNum}
        categories={categories}
        fixedCategory={cat}
        onDone={() => setAddingFor(null)}
      />
    ) : null;

  const renderAddBtn = (key: string, cat: CategoryProps, label = "+ Add rider") =>
    isRaceActive ? null : (
      <button
        className={styles.catAddBtn}
        onClick={() => setAddingFor((k) => (k === key ? null : key))}
        data-testid={`checkin-add-${cat.name}`}
      >
        {addingFor === key ? "− Close" : label}
      </button>
    );

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
          {renderAddBtn(key, cat)}
        </div>
        {renderAddForm(key, cat)}
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
            <div className={styles.addChips}>
              {visibleCats.map((c) => (
                <React.Fragment key={catKey(c)}>{renderAddBtn(catKey(c), c, `+ ${c.name}`)}</React.Fragment>
              ))}
            </div>
            {visibleCats.map((c) => (
              <React.Fragment key={catKey(c)}>{renderAddForm(catKey(c), c)}</React.Fragment>
            ))}
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
    { key: "standing", label: "Standing" },
    { key: "bib", label: "Bib" },
    { key: "name", label: "Name" },
  ];

  return (
    <div className={styles.container}>
      {isRaceActive && (
        <div className={styles.raceLockBanner}>
          🏁 Race in progress — check-in locked. You can still change rider status.
        </div>
      )}
      <div className={styles.stickyBar}>
        <div className={styles.toolbar}>
          <div className={styles.searchWrap}>
            <img src={Icons.search} alt="" width={14} height={14} />
            <input
              className={styles.search}
              placeholder="Search name or bib…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className={styles.catSelect} value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
            <option value="all">All categories</option>
            {catNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewBtn} ${viewMode === "list" ? styles.viewBtnActive : ""}`}
              onClick={() => setViewMode("list")}
              title="List view"
            >☰</button>
            <button
              className={`${styles.viewBtn} ${viewMode === "cards" ? styles.viewBtnActive : ""}`}
              onClick={() => setViewMode("cards")}
              title="Card view"
            >⊞</button>
          </div>
        </div>

        <div className={styles.sortBar}>
          <span className={styles.sortLabel}>Sort</span>
          <div className={styles.scopeToggle}>
            {sortOptions.map((o) => (
              <button
                key={o.key}
                className={`${styles.scopeBtn} ${sortKey === o.key ? styles.scopeBtnActive : ""}`}
                onClick={() => setSortKey(o.key)}
              >{o.label}</button>
            ))}
          </div>
          <button
            className={styles.dirBtn}
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >{sortDir === "asc" ? "▲ 1→9" : "▼ 9→1"}</button>
          <span className={styles.sortLabel}>Within</span>
          <div className={styles.scopeToggle}>
            <button
              className={`${styles.scopeBtn} ${sortScope === "category" ? styles.scopeBtnActive : ""}`}
              onClick={() => setSortScope("category")}
            >Category</button>
            <button
              className={`${styles.scopeBtn} ${sortScope === "wave" ? styles.scopeBtnActive : ""}`}
              onClick={() => setSortScope("wave")}
            >Whole wave</button>
          </div>
        </div>
      </div>

      <div className={styles.counts}>
        <span className={styles.countItem}>✓ {waveRiders.filter((r) => r.checked).length} checked</span>
        <span className={styles.countItem}>✗ {waveRiders.filter((r) => r.status === "DNS").length} DNS</span>
        <span className={styles.countItem}>Total {waveRiders.length}</span>
        {!allAccountedFor && !isRaceActive && (
          <button className={styles.checkAllBtn} onClick={checkAll}>
            ✓ Check All
          </button>
        )}
      </div>

      <div className={styles.groupWrap}>{slotList.map(renderSlot)}</div>

      {selectedRider && <StatusModal rider={selectedRider} onStatusChange={handleStatusChange} />}
    </div>
  );
};

export default CheckIn;
