/**
 * RaceSetupSettings — the one Race Setup panel (Joker, board hold, voice input).
 * Rendered by both the main side menu and the race sidebar, so every race
 * screen — Live included — reaches the same controls and the same persisted
 * stores (useJokerMode, boardHoldStore, voiceSettingsStore). Don't fork it.
 */
import React, { Suspense, lazy, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import { useJokerMode } from "@/hooks/useJokerMode";
import { BOARD_HOLD_OPTIONS, CARD_COVER_OPTIONS, DEFAULT_CARD_COVER_MS, useBoardHold } from "@/stores/boardHoldStore";
import { useVoiceSettingsStore } from "@/stores/voiceSettingsStore";
import { isIos, isStandalone } from "@/components/pwa/usePwaInstall";
import styles from "./raceSetupSettings.module.css";
import { keypadLayoutById, useKeypadLayoutStore } from "../../race/[id]/heat/[heatId]/rapidEntry/keypadLayouts";

// Settings → Keyboard: full-screen preview of the real Live keypad (loaded on demand).
const KeyboardStudio = lazy(() => import("../../race/[id]/heat/[heatId]/rapidEntry/KeyboardStudio"));

/** The board hold that ships as default (boardHoldStore). */
const DEFAULT_HOLD_MS = 2000;

/** Small ⓘ button that reveals a longer explanation on tap instead of keeping
 *  the paragraph on screen. Click, not hover, so it works on touch. */
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        className={`${styles.infoBtn} ${open ? styles.infoBtnActive : ''}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(o => !o)}
      >
        <Info aria-hidden="true" />
      </button>
      {open && (
        <p id={id} role="note" className={styles.infoText} dir="auto">
          {children}
        </p>
      )}
    </>
  );
}

/** One-line summary for a collapsed Race Setup header, e.g. "2 s". */
export function useRaceSetupSummary(): string {
  const { t } = useTranslation();
  const holdMs = useBoardHold((s) => s.holdMs);
  return t("prefs.seconds", "{{n}} s", { n: holdMs / 1000 });
}

export default function RaceSetupSettings() {
  const { t } = useTranslation();
  const id = useId();
  const { jokerEnabled, toggleJokerEnabled } = useJokerMode();
  const { holdMs, setHoldMs, coverMs, setCoverMs } = useBoardHold();
  const { settings: voiceSettings, setLanguage: setVoiceLanguage, setAutoConfirm, setEnabled: setVoiceEnabled } = useVoiceSettingsStore();
  const seconds = (ms: number) => t("prefs.seconds", "{{n}} s", { n: ms / 1000 });
  const keypadLayout = keypadLayoutById(useKeypadLayoutStore((s) => s.layoutId));
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  return (
    <div className={styles.root}>
      <div className={styles.subLabel}>{t("prefs.groupBoard", "Live board")}</div>
      {/* Joker — instant time+arrival stamp for riders the commissaire
          can't identify fast enough, resolved to a bib later */}
      <div className={styles.settingRow}>
        <label className={styles.settingLabel} htmlFor={`${id}-joker`}>
          {t("prefs.joker", "Joker button")}
        </label>
        <InfoTip label={t("prefs.aboutJoker", "About the Joker button")}>
          {t("prefs.jokerInfo", "Shows a Joker button on the live wave screen. Tap it to stamp a rider's arrival time instantly when you can't read their bib in time — assign the bib afterward.")}
        </InfoTip>
        <input
          id={`${id}-joker`}
          type="checkbox"
          className={styles.switch}
          checked={jokerEnabled}
          onChange={toggleJokerEnabled}
          aria-label={t("prefs.jokerAria", "Show Joker button on the live wave screen")}
        />
      </div>
      {/* Board hold — stops the live board reshuffling under the
          commissaire while a whole bunch is being called out. */}
      <div className={styles.settingRow}>
        <label className={styles.settingLabel} htmlFor={`${id}-hold`}>
          {t("prefs.boardHold", "Board hold")}
        </label>
        <InfoTip label={t("prefs.aboutBoardHold", "About board hold")}>
          {t("prefs.boardHoldInfo", "When riders arrive in a bunch, tapped cards stay put — marked with a green ✓ — and all drop to the bottom together once {{n}} seconds pass with no new tap. Stops the board reshuffling while you're still reading bibs.", { n: holdMs / 1000 })}
        </InfoTip>
        <select
          id={`${id}-hold`}
          className={`${styles.select} ${styles.selectSmall}`}
          value={holdMs}
          onChange={(e) => setHoldMs(Number(e.target.value))}
          aria-label="Board hold delay"
        >
          {BOARD_HOLD_OPTIONS.map((ms) => (
            <option key={ms} value={ms}>
              {seconds(ms)}{ms === DEFAULT_HOLD_MS ? ` (${t("prefs.default", "default")})` : ''}
            </option>
          ))}
        </select>
      </div>
      {/* Card cover — how long a tapped card stays washed out, even after it moved */}
      <div className={styles.settingRow}>
        <label className={styles.settingLabel} htmlFor={`${id}-cover`}>
          {t("prefs.cardCover", "Card cover")}
        </label>
        <InfoTip label={t("prefs.aboutCardCover", "About card cover")}>
          {t("prefs.cardCoverInfo", "How long a tapped card stays washed out, so you can see who just passed. The card keeps it after it drops to the bottom. Board hold still decides when it moves.")}
        </InfoTip>
        <select
          id={`${id}-cover`}
          className={`${styles.select} ${styles.selectSmall}`}
          value={coverMs}
          onChange={(e) => setCoverMs(Number(e.target.value))}
          aria-label="Card cover time"
        >
          {CARD_COVER_OPTIONS.map((ms) => (
            <option key={ms} value={ms}>
              {ms < 60000 ? seconds(ms) : t("prefs.minutes", "{{n}} min", { n: ms / 60000 })}
              {ms === DEFAULT_CARD_COVER_MS ? ` (${t("prefs.default", "default")})` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Keypad layout on Live (Rapid Entry) — keypadLayouts store, this device only */}
      <div className={styles.settingRow}>
        <span className={styles.settingLabel} dir="auto">
          {t("prefs.keyboard", "Keypad layout")}: {keypadLayout.name}
        </span>
        <button type="button" className={styles.segment} onClick={() => setKeyboardOpen(true)} data-testid="open-keyboard-settings">
          {t("prefs.keyboardBtn", "KEYBOARD")}
        </button>
      </div>
      {keyboardOpen && (
        <Suspense fallback={null}>
          <KeyboardStudio onClose={() => setKeyboardOpen(false)} />
        </Suspense>
      )}

      {/* Voice input on Live — voiceSettingsStore, read live by the heat page */}
      <div className={styles.subLabel}>{t("prefs.groupVoice", "Voice input")}</div>
      {isIos() && isStandalone() && (
        <p className={styles.warnLine} dir="auto">
          {t("prefs.voiceIosPwa", "Voice doesn't work in the installed app on iPhone/iPad — open Commissaire in Safari.")}
        </p>
      )}
      <div className={styles.settingRow}>
        <label className={styles.settingLabel} htmlFor={`${id}-voice-enabled`}>
          {t("prefs.voiceEnabled", "Voice input on Live (experimental)")}
        </label>
        <input
          id={`${id}-voice-enabled`}
          type="checkbox"
          className={styles.switch}
          checked={voiceSettings.enabled}
          onChange={(e) => setVoiceEnabled(e.target.checked)}
          data-testid="voice-enabled"
        />
      </div>
      {voiceSettings.enabled && (<>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel} id={`${id}-voice-lang`}>
          {t("prefs.voiceLanguage", "Language")}
        </span>
        <InfoTip label={t("prefs.aboutVoice", "About voice input")}>
          {t("prefs.voiceInfo", "Speech engine: Web Speech API. Whether it runs on the device (works offline) or in the cloud (needs internet) is shown on the Live mic button while voice is on.")}
        </InfoTip>
        <div className={`${styles.segmented} ${styles.segmentedInline}`} role="group" aria-labelledby={`${id}-voice-lang`}>
          {([['en', 'English'], ['he', 'עברית']] as const).map(([code, label]) => (
            <button
              key={code}
              type="button"
              className={styles.segment}
              aria-pressed={voiceSettings.language === code}
              onClick={() => setVoiceLanguage(code)}
              data-testid={`voice-lang-${code}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.settingRow}>
        <label className={styles.settingLabel} htmlFor={`${id}-auto-confirm`}>
          {t("prefs.autoConfirm", "Auto-record spoken bibs")}
        </label>
        <InfoTip label={t("prefs.aboutAutoConfirm", "About auto-record")}>
          {voiceSettings.autoConfirm
            ? t("prefs.autoConfirmOnInfo", "Experimental — speaking a bib number records the lap immediately, same as tapping the rider. Not 100% reliable yet, so double-check the board. Every spoken bib is also saved to the voice buffer (the list icon next to the mic on Live).")
            : t("prefs.autoConfirmOffInfo", "Assist mode: speaking a bib number records nothing by itself — it only goes to the voice buffer (the list icon next to the mic on Live shows the last 30 bibs heard, with the time).")}
        </InfoTip>
        <input
          id={`${id}-auto-confirm`}
          type="checkbox"
          className={styles.switch}
          checked={voiceSettings.autoConfirm}
          onChange={(e) => setAutoConfirm(e.target.checked)}
          data-testid="voice-auto-confirm"
        />
      </div>
      </>)}
    </div>
  );
}
