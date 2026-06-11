import React, { useState } from "react";
import styles from "./quickAddRider.module.css";
import { CategoryProps } from "@/types/types";
import useRiderStore from "@/stores/ridersStore";

interface Props {
  raceUuid: string;
  waveNum: number;
  categories: CategoryProps[];
  onDone: () => void;
}

const QuickAddRider: React.FC<Props> = ({ raceUuid, waveNum, categories, onDone }) => {
  const { riders, addNewRider } = useRiderStore();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    bibNumber: "",
    team: "",
    chipNumber: "",
    category: categories[0]?.name ?? "",
    relegation: false,
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.firstName || !form.lastName || !form.bibNumber) return;
    const cat = categories.find((c) => c.name === form.category);
    const raceRiders = riders.filter((r) => r.raceUuid === raceUuid);

    const newRider = {
      id: Date.now(),
      raceUuid,
      bibNumber: Number(form.bibNumber),
      firstName: form.firstName,
      lastName: form.lastName,
      team: form.team || null,
      chipNumber: form.chipNumber || undefined,
      category: form.category,
      heat: waveNum,
      color: cat?.color ?? null,
      totalLaps: cat?.laps ?? 0,
      laps: cat?.laps ?? 0,
      checked: true,
      distance: null,
      elapsedLastLap: null,
      elapsedTimeFromStart: null,
      timeStartRace: null,
      timeArrive: null,
      flag: null,
      lapsCounter: 0,
      lapsDetails: [],
      position_start: raceRiders.filter((r) => r.category === form.category).length + 1,
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
      <div className={styles.formTitle}>Quick Add Rider</div>
      <div className={styles.row2}>
        <input className={styles.input} placeholder="First name *" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
        <input className={styles.input} placeholder="Last name *" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
      </div>
      <div className={styles.row2}>
        <input className={styles.input} placeholder="Bib # *" type="number" value={form.bibNumber} onChange={(e) => set("bibNumber", e.target.value)} />
        <input className={styles.input} placeholder="Chip number" value={form.chipNumber} onChange={(e) => set("chipNumber", e.target.value)} />
      </div>
      <input className={styles.input} placeholder="Club / team" value={form.team} onChange={(e) => set("team", e.target.value)} />
      <select className={styles.input} value={form.category} onChange={(e) => set("category", e.target.value)}>
        {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
      </select>
      <label className={styles.checkLabel}>
        <input type="checkbox" checked={form.relegation} onChange={(e) => set("relegation", e.target.checked)} />
        Relegated (sets status to DSQ)
      </label>
      <div className={styles.formActions}>
        <button className={styles.cancelBtn} onClick={onDone}>Cancel</button>
        <button className={styles.saveBtn} onClick={handleSave}>Add Rider</button>
      </div>
    </div>
  );
};

export default QuickAddRider;
