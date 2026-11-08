/**
 * Other Bike Races (0.3.4) on My Races: public races this browser opened through a
 * share link (share/otherRaces.ts, localStorage only). Kept apart from the account's
 * own and judged races — these open the read-only spectator page, never the race.
 */
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Eye, X } from "lucide-react";
import { forgetOtherRace, listOtherRaces } from "../share/otherRaces";
import styles from "./otherBikeRaces.module.css";

export default function OtherBikeRaces() {
  const [races, setRaces] = useState(listOtherRaces);
  if (races.length === 0) return null;
  return (
    <section className={styles.section} data-testid="other-bike-races">
      <h2 className={styles.title}>Other Bike Races</h2>
      <ul className={styles.list}>
        {races.map((r) => (
          <li key={r.token} className={styles.row}>
            <Link to={`/share/${r.token}`} className={styles.link}>
              <Eye size={15} aria-hidden="true" />
              <span className={styles.main}>
                <span className={styles.name} dir="auto">{r.name}</span>
                <span className={styles.sub} dir="auto">{[r.date, r.location].filter(Boolean).join(" · ")}</span>
              </span>
            </Link>
            <button
              type="button"
              className={styles.remove}
              aria-label={`Remove ${r.name}`}
              onClick={() => {
                forgetOtherRace(r.token);
                setRaces(listOtherRaces());
              }}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
