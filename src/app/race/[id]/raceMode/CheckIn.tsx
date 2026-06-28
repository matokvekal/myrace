import React, { useEffect, useState } from "react";
import styles from "./checkIn.module.css";
import { CategoryProps, RiderProps } from "@/types/types";
import useRiderStore from "@/stores/ridersStore";
import useUIStore from "@/stores/uiStore";
import StatusModal from "../../components/modals/StatusModal";
import QuickAddRider from "./QuickAddRider";
import Icons from "@/constants/Icons";

interface Props {
  raceUuid: string;
  waveNum: number;
  categories: CategoryProps[];
}

const CheckIn: React.FC<Props> = ({ raceUuid, waveNum, categories }) => {
  const { riders, getRiders, updateRider } = useRiderStore();
  const { openModal } = useUIStore();
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [selectedRider, setSelectedRider] = useState<RiderProps | null>(null);
  const [showAdd, setShowAdd] = useState(false);

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

  const toggleCheck = async (rider: RiderProps) => {
    const current = riders.find((r) => r.id === rider.id);
    if (current) {
      await updateRider({ ...current, checked: !current.checked });
    }
  };

  const checkAll = async () => {
    const riderIds = new Set(filtered.filter((r) => !r.checked && !["DNS", "DNF", "DSQ"].includes(r.status)).map((r) => r.id));
    for (const riderId of riderIds) {
      const current = riders.find((r) => r.id === riderId);
      if (current && !current.checked) {
        await updateRider({ ...current, checked: true });
      }
    }
  };

  const allAccountedFor = filtered.length > 0 && filtered.every(
    (r) => r.checked || ["DNS", "DNF", "DSQ"].includes(r.status)
  );

  const isRaceActive = categories.some(
    (c) => c.status === "running" || c.status === "finished"
  );

  const handleStatusChange = async (status: any) => {
    if (selectedRider) {
      const current = riders.find((r) => r.id === selectedRider.id);
      if (current) await updateRider({ ...current, status });
    }
  };

  return (
    <div className={styles.container}>
      {isRaceActive && (
        <div className={styles.raceLockBanner}>
          🏁 Race in progress — check-in locked. You can still change rider status.
        </div>
      )}
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
      </div>

      <div className={styles.counts}>
        <span className={styles.countItem}>✓ {waveRiders.filter((r) => r.checked).length} checked</span>
        <span className={styles.countItem}>✗ {waveRiders.filter((r) => r.status === "DNS").length} DNS</span>
        <span className={styles.countItem}>Total {waveRiders.length}</span>
        {!allAccountedFor && !isRaceActive && (
          <button className={styles.checkAllBtn} onClick={() => checkAll()}>
            ✓ Check All
          </button>
        )}
      </div>

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
              {/* Left control: circle OR status badge */}
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
                  /* Race running — show lock icon + status button only */
                  <>
                    <span className={`${styles.checkBtn} ${rider.checked ? styles.checkedBtn : styles.lockedBtn}`} title="Check-in locked" />
                    <button
                      className={styles.statusTrigger}
                      onClick={() => { setSelectedRider(rider); openModal("modalStatus"); }}
                    >
                      Status
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className={`${styles.checkBtn} ${rider.checked ? styles.checkedBtn : ""}`}
                      onClick={() => void toggleCheck(rider)}
                      title={rider.checked ? "Uncheck" : "Check in"}
                    />
                    <button
                      className={styles.statusTrigger}
                      onClick={() => { setSelectedRider(rider); openModal("modalStatus"); }}
                    >
                      Status
                    </button>
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
