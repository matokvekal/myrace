/**
 * RaceTopBar — the one compact header on every screen inside a race (Create,
 * Race, Live, Results): hamburger · race name · current mode, plus an optional
 * right-hand slot for screen-specific controls (Live's clock and settings).
 * The hamburger opens the shared RaceSidebar, the only mode navigation.
 */
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Menu } from "lucide-react";
import useRaceStore from "@/stores/racesStore";
import RaceSidebar, { useModeItems } from "./RaceSidebar";
import { useRaceModeNav } from "./useRaceModeNav";
import styles from "./raceSidebar.module.css";

const MENU_BUTTON_ID = "race-menu-button";

const RaceTopBar: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const nav = useRaceModeNav();
  const race = useRaceStore((s) => s.races.find((r) => r.uuid === nav.raceUuid));
  const items = useModeItems();
  const current = items.find((i) => i.key === nav.mode);

  const close = () => {
    setOpen(false);
    document.getElementById(MENU_BUTTON_ID)?.focus();
  };

  return (
    <>
      <header className={styles.topBar} data-mode={nav.mode}>
        <button
          id={MENU_BUTTON_ID}
          type="button"
          className={styles.menuBtn}
          aria-label={t("raceNav.open", "Open race menu")}
          aria-expanded={open}
          aria-controls="race-side-menu"
          onClick={() => setOpen(true)}
          data-testid="race-menu-btn"
        >
          <Menu aria-hidden="true" />
        </button>
        <div className={styles.titleBlock}>
          <div className={styles.raceName} dir="auto">
            {race?.name || t("heat.defaultRaceName", "Race")}
          </div>
          {nav.finalized && nav.mode === "setup" ? (
            <span className={`${styles.modeChip} ${styles.modeFinal}`} data-testid="phase-final">
              🔒 {t("phase.final", "Final results")}
            </span>
          ) : (
            current && (
              <span
                className={`${styles.modeChip} ${styles[`mode_${nav.mode}`]}`}
                data-testid="race-mode-indicator"
                data-mode={nav.mode}
              >
                {nav.mode === "live" ? <span className={styles.liveDot} aria-hidden="true" /> : current.icon}
                {current.label}
              </span>
            )
          )}
        </div>
        {children && <div className={styles.slot}>{children}</div>}
      </header>
      <RaceSidebar open={open} onClose={close} raceName={race?.name} raceDate={race?.date} />
    </>
  );
};

export default RaceTopBar;
