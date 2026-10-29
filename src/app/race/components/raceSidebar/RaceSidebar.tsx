/**
 * RaceSidebar — the single mode navigation inside a race: Create · Race · Live ·
 * Results, then All Races. Same visual language as the main-page side menu.
 * A finished race has no Race or Live left, so those rows drop out.
 */
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, House, Flag, Radio, Sliders, Timer, Trophy, X, LayoutDashboard } from "lucide-react";
import RaceSetupSettings, { useRaceSetupSummary } from "@/components/raceSetup/RaceSetupSettings";
import { useRaceModeNav, type RaceMode } from "./useRaceModeNav";
import styles from "./raceSidebar.module.css";

export function useModeItems() {
  const { t } = useTranslation();
  const { finalized } = useRaceModeNav();
  const all: { key: RaceMode; label: string; icon: React.ReactNode }[] = [
    { key: "setup", label: t("phase.setup", "Create"), icon: <Sliders aria-hidden="true" /> },
    { key: "race", label: t("phase.race", "Race"), icon: <Flag aria-hidden="true" /> },
    { key: "live", label: t("phase.live", "Live"), icon: <Radio aria-hidden="true" /> },
    { key: "results", label: t("phase.results", "Results"), icon: <Trophy aria-hidden="true" /> },
    { key: "board", label: t("phase.board", "Board"), icon: <LayoutDashboard aria-hidden="true" /> },
  ];
  return finalized ? all.filter((i) => i.key === "setup" || i.key === "results" || i.key === "board") : all;
}

const RaceSidebar: React.FC<{
  open: boolean;
  onClose: () => void;
  raceName?: string;
  raceDate?: string;
}> = ({ open, onClose, raceName, raceDate }) => {
  const { t } = useTranslation();
  const { mode, go, goAllRaces } = useRaceModeNav();
  const items = useModeItems();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const setupSummary = useRaceSetupSummary();

  // Keyboard: focus moves into the drawer on open, Escape closes it.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {open && <div className={styles.overlay} onClick={onClose} />}
      <aside
        id="race-side-menu"
        className={`${styles.drawer} ${open ? styles.drawerOpen : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("raceNav.menu", "Race menu")}
      >
        <div className={styles.drawerHeader}>
          <div className={styles.drawerTitleBlock}>
            <div className={styles.drawerKicker}>{t("raceNav.kicker", "Race")}</div>
            <div className={styles.drawerTitle} dir="auto">{raceName || t("heat.defaultRaceName", "Race")}</div>
            {raceDate && <div className={styles.drawerSub} dir="auto">{raceDate}</div>}
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.closeBtn}
            aria-label={t("raceNav.close", "Close race menu")}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <div className={styles.drawerScroll}>
        <nav className={styles.nav} aria-label={t("raceNav.modes", "Race modes")}>
          {/* Home: back to the main race list. Always first, on every race screen. */}
          <button
            type="button"
            className={styles.navItem}
            data-testid="race-nav-all"
            onClick={() => {
              onClose();
              goAllRaces();
            }}
          >
            <span className={styles.navIcon}><House aria-hidden="true" /></span>
            <span>{t("raceNav.allRaces", "All Races")}</span>
          </button>
          <div className={styles.navDivider} role="separator" />
          {items.map((it) => {
            const active = mode === it.key;
            return (
              <button
                key={it.key}
                type="button"
                className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                aria-current={active ? "page" : undefined}
                data-testid={`race-nav-${it.key}`}
                onClick={() => {
                  go[it.key]();
                  onClose();
                }}
              >
                <span className={`${styles.navIcon} ${styles[`icon_${it.key}`]}`}>{it.icon}</span>
                <span>{it.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Race Setup — the same panel as the main side menu's, so Live and
            every other race screen can retune it without leaving the race. */}
        <div className={styles.setup}>
          <button
            type="button"
            className={styles.setupHeader}
            aria-expanded={setupOpen}
            aria-controls="race-setup-body"
            onClick={() => setSetupOpen((o) => !o)}
            data-testid="race-nav-setup-settings"
          >
            <span className={styles.navIcon}><Timer aria-hidden="true" /></span>
            <span className={styles.setupTitle}>{t("prefs.timing", "Race Setup")}</span>
            {!setupOpen && <span className={styles.setupSummary}>{setupSummary}</span>}
            <ChevronDown className={`${styles.setupChevron} ${setupOpen ? styles.setupChevronOpen : ""}`} aria-hidden="true" />
          </button>
          {setupOpen && (
            <div id="race-setup-body" className={styles.setupBody} role="group" aria-label={t("prefs.timing", "Race Setup")}>
              <RaceSetupSettings />
            </div>
          )}
        </div>
        </div>
      </aside>
    </>
  );
};

export default RaceSidebar;
