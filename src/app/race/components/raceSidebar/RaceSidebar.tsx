/**
 * RaceSidebar — the single mode navigation inside a race: Create · Race · Live ·
 * Results, then All Races. Same visual language as the main-page side menu.
 * A finished race has no Race or Live left, so those rows drop out.
 */
import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Flag, Radio, Sliders, Trophy, X } from "lucide-react";
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
  ];
  return finalized ? all.filter((i) => i.key === "setup" || i.key === "results") : all;
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

        <nav className={styles.nav} aria-label={t("raceNav.modes", "Race modes")}>
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

        <div className={styles.navFooter}>
          <button
            type="button"
            className={styles.navItem}
            data-testid="race-nav-all"
            onClick={() => {
              onClose();
              goAllRaces();
            }}
          >
            <span className={`${styles.navIcon} ${styles.flipRtl}`}><ArrowLeft aria-hidden="true" /></span>
            <span>{t("raceNav.allRaces", "All Races")}</span>
          </button>
        </div>
      </aside>
    </>
  );
};

export default RaceSidebar;
