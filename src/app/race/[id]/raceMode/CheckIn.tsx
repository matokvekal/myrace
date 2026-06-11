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

  const waveRiders = riders.filter(
    (r) => r.raceUuid === raceUuid && r.heat === waveNum
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

  const toggleCheck = (rider: RiderProps) => {
    updateRider({ ...rider, checked: !rider.checked });
  };

  const handleStatusChange = (status: any) => {
    if (selectedRider) updateRider({ ...selectedRider, status });
  };

  return (
    <div className={styles.container}>
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
      </div>

      <div className={styles.list}>
        {filtered.map((rider) => (
          <div key={rider.id} className={`${styles.row} ${rider.checked ? styles.checked : ""} ${["DNS","DNF","DSQ"].includes(rider.status) ? styles.out : ""}`}>
            <button className={styles.checkBtn} onClick={() => toggleCheck(rider)}>
              {rider.checked ? "✓" : "○"}
            </button>
            <span className={styles.bib}>#{rider.bibNumber}</span>
            <span className={styles.name}>{rider.lastName} {rider.firstName}</span>
            <span className={styles.cat}>{rider.category}</span>
            <div className={styles.statusBtns}>
              <button
                className={`${styles.statusBtn} ${rider.status === "DNS" ? styles.dnsActive : ""}`}
                onClick={() => { setSelectedRider(rider); openModal("modalStatus"); }}
              >
                {["DNS","DNF","DSQ"].includes(rider.status) ? rider.status : "Status"}
              </button>
            </div>
          </div>
        ))}
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
