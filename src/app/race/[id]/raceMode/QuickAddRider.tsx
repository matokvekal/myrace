import React, { useState } from "react";
import styles from "./quickAddRider.module.css";
import { CategoryProps } from "@/types/types";
import useRiderStore from "@/stores/ridersStore";

interface Props {
  raceUuid: string;
  waveNum: number;
  categories: CategoryProps[];
  /** When set, the rider is added to this category and the picker is hidden. */
  fixedCategory?: CategoryProps;
  onDone: () => void;
}

const QuickAddRider: React.FC<Props> = ({ raceUuid, waveNum, categories, fixedCategory, onDone }) => {
  const { riders, addNewRider } = useRiderStore();
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    bibNumber: "",
    team: "",
    chipNumber: "",
    category: fixedCategory?.name ?? categories[0]?.name ?? "",
    relegation: false,
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.firstName || !form.lastName || !form.bibNumber) {
      setError("First name, last name and bib are required");
      return;
    }
    const bib = Number(form.bibNumber);
    const raceRiders = riders.filter((r) => r.raceUuid === raceUuid);
    const clash = raceRiders.find((r) => r.bibNumber === bib);
    if (clash) {
      setError(`Bib ${bib} already used by ${clash.lastName} ${clash.firstName}`);
      return;
    }
    const cat = fixedCategory ?? categories.find((c) => c.name === form.category);
    const sameCat = raceRiders.filter(
      (r) => r.category === form.category && (r.subCategory ?? null) === (cat?.subCategory ?? null)
    );
    const nextStanding = sameCat.length + 1;

    const newRider = {
      id: Date.now(),
      raceUuid,
      bibNumber: bib,
      firstName: form.firstName,
      lastName: form.lastName,
      team: form.team || null,
      chipNumber: form.chipNumber || undefined,
      category: form.category,
      subCategory: cat?.subCategory ?? null,
      heat: waveNum,
      color: cat?.color ?? null,
      // `totalLaps` is the only lap field on RiderProps. A stray `laps` used to be
      // written alongside it — not part of the model, dead data in IndexedDB, and
      // an invitation to read the wrong one (BUGS.md #21). Laps still resolve
      // through the category via effectiveTotalLaps()/withCategoryLaps().
      totalLaps: cat?.laps ?? 0,
      checked: true,
      distance: null,
      elapsedLastLap: null,
      elapsedTimeFromStart: null,
      timeStartRace: null,
      timeArrive: null,
      flag: null,
      lapsCounter: 0,
      lapsDetails: [],
      standing: nextStanding,
      position_start: nextStanding,
      position_category: 0,
      position_race: 0,
      raceStatus: "upcoming" as const,
      status: form.relegation ? "DSQ" as const : "standing" as const,
      viewOrder: 0,
      image: null,
      comment: form.relegation ? "Relegated" : null,
    };

    await addNewRider(newRider);
    onDone();
  };

  return (
    <div className={styles.form}>
      <div className={styles.formTitle}>
        Add rider{fixedCategory ? ` to ${fixedCategory.name}` : ""}
      </div>
      <div className={styles.row2}>
        <input className={styles.input} placeholder="First name *" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
        <input className={styles.input} placeholder="Last name *" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
      </div>
      <div className={styles.row2}>
        <input className={styles.input} placeholder="Bib # *" type="number" value={form.bibNumber} onChange={(e) => { set("bibNumber", e.target.value); setError(""); }} />
        <input className={styles.input} placeholder="Chip number" value={form.chipNumber} onChange={(e) => set("chipNumber", e.target.value)} />
      </div>
      <input className={styles.input} placeholder="Club / team" value={form.team} onChange={(e) => set("team", e.target.value)} />
      {!fixedCategory && (
        <select className={styles.input} value={form.category} onChange={(e) => set("category", e.target.value)}>
          {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
      )}
      <label className={styles.checkLabel}>
        <input type="checkbox" checked={form.relegation} onChange={(e) => set("relegation", e.target.checked)} />
        Relegated (sets status to DSQ)
      </label>
      {error && <div style={{ color: "#c2182b", fontSize: 12, fontWeight: 700 }}>{error}</div>}
      <div className={styles.formActions}>
        <button className={styles.cancelBtn} onClick={onDone}>Cancel</button>
        <button className={styles.saveBtn} onClick={handleSave}>Add Rider</button>
      </div>
    </div>
  );
};

export default QuickAddRider;
