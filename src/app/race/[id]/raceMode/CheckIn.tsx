import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./checkIn.module.css";
import { CategoryProps, RiderProps } from "@/types/types";
import useRiderStore from "@/stores/ridersStore";
import useUIStore from "@/stores/uiStore";
import StatusModal from "../../components/modals/StatusModal";
import QuickAddRider from "./QuickAddRider";
import Icons from "@/constants/Icons";
import { recordRaceEvent } from "@/services/cloud/raceEvents";
import { canForRace } from "@/services/cloud/permissions";

interface Props {
  raceUuid: string;
  waveNum: number;
  categories: CategoryProps[];
}

const CheckIn: React.FC<Props> = ({ raceUuid, waveNum, categories }) => {
  const navigate = useNavigate();
  const { riders, getRiders, updateRider } = useRiderStore();
  const { openModal } = useUIStore();
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [selectedRider, setSelectedRider] = useState<RiderProps | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "cards">("list");

  useEffect(() => { getRiders(raceUuid); }, [raceUuid, getRiders]);

  const waveCatNames = new Set(categories.map((c) => c.name));
  const waveRiders = riders.filter(
    (r) => r.raceUuid === raceUuid && waveCatNames.has(r.category)
  );

  const filtered = waveRiders.filter((r) => {
    if (filterCat !== "all" && r.category !== filterCat) return false;
    const q = search.toLowerCase();
    return (
      !q ||
      r.firstName.toLowerCase().includes(q) ||
      r.lastName.toLowerCase().includes(q) ||
      String(r.bibNumber).includes(q)
    );
  });

  const catNames = [...new Set(waveRiders.map((r) => r.category))].sort();

  const recordCheckin = (rider: RiderProps, checked: boolean) => {
    void recordRaceEvent({
      raceUuid,
      riderId: rider.id,
      bibNumber: rider.bibNumber,
      eventType: "RIDER_CHECKIN",
      payload: { riderLocalId: rider.id, riderPatch: { checked } },
    });
  };

  const toggleCheck = (rider: RiderProps) => {
    if (!canForRace(raceUuid, "CHECKIN_RIDER")) return;
    updateRider({ ...rider, checked: !rider.checked });
    recordCheckin(rider, !rider.checked);
  };

  const checkAll = () => {
    if (!canForRace(raceUuid, "CHECKIN_RIDER")) return;
    const unchecked = filtered.filter((r) => !r.checked && !["DNS", "DNF", "DSQ"].includes(r.status));
    unchecked.forEach((r) => {
      updateRider({ ...r, checked: true });
      recordCheckin(r, true);
    });
  };

  const allAccountedFor = filtered.length > 0 && filtered.every(
    (r) => r.checked || ["DNS", "DNF", "DSQ"].includes(r.status)
  );

  const isRaceActive = categories.some(
    (c) => c.status === "running" || c.status === "finished"
  );

  const handleStatusChange = (status: any) => {
    if (selectedRider) updateRider({ ...selectedRider, status });
  };

  return (
    <div className={styles.container}>
      {isRaceActive && (
        <div className={styles.raceLockBanner}>
          🏁 Race in progress — check-in locked. You can still change rider status.
        </div>
      )}
      <button
        className={styles.goLiveBtn}
        onClick={() => navigate(`/race/${raceUuid}/heat/${waveNum}`)}
      >
        Go Live →
      </button>
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
          <option value="all">All</option>
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

      {viewMode === "list" ? (
        <div className={styles.list}>
          {filtered.map((rider) => {
            const hasStatus = ["DNS", "DNF", "DSQ"].includes(rider.status);
            const statusClass = rider.status === "DNS"
              ? styles.dnsBadge
              : rider.status === "DNF"
              ? styles.dnfBadge
              : rider.status === "DSQ"
              ? styles.dsqBadge
              : "";
            return (
              <div key={rider.id} className={`${styles.row} ${rider.checked ? styles.checked : ""} ${hasStatus ? styles.out : ""}`}>
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
                      <button className={styles.statusTrigger} onClick={() => { setSelectedRider(rider); openModal("modalStatus"); }}>Status</button>
                    </>
                  )}
                </div>
                <span className={styles.bib}>#{rider.bibNumber}</span>
                <span className={styles.name}>{rider.lastName} {rider.firstName}</span>
                <span className={styles.cat}>{rider.category}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.cardGrid}>
          {filtered.map((rider) => {
            const hasStatus = ["DNS", "DNF", "DSQ"].includes(rider.status);
            const isChecked = rider.checked;
            const cat = categories.find((c) => c.name === rider.category);
            const catColor = cat?.color ?? "#63a6fc";
            const tileBg = isChecked
              ? `linear-gradient(160deg, #3edda4, #2fcf95)`
              : hasStatus
              ? "#d0d8ea"
              : catColor;
            return (
              <div key={rider.id} className={`${styles.checkTile} ${hasStatus ? styles.checkTileOut : ""}`}>
                <div className={styles.checkTileInner} style={{ background: tileBg }}>
                  <button
                    className={styles.tileStatusTrigger}
                    onClick={() => { setSelectedRider(rider); openModal("modalStatus"); }}
                    title="Change status"
                  >⋯</button>
                  {isChecked && !hasStatus && <div className={styles.checkMark}>✓</div>}
                  <div className={styles.checkTileBib}>{rider.bibNumber}</div>
                  {hasStatus && <div className={styles.tileStatusBadge}>{rider.status}</div>}
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
          })}
        </div>
      )}

      <button className={styles.addBtn} onClick={() => setShowAdd((v) => !v)}>
        {showAdd ? "− Close" : "+ Quick Add Rider"}
      </button>

      {showAdd && (
        <QuickAddRider
          raceUuid={raceUuid}
          waveNum={waveNum}
          categories={categories}
          onDone={() => setShowAdd(false)}
        />
      )}

      {selectedRider && <StatusModal rider={selectedRider} onStatusChange={handleStatusChange} />}
    </div>
  );
};

export default CheckIn;
