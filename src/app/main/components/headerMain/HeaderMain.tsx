import React, { useState, useEffect, useId, useRef } from "react";
import styles from "./headerMain.module.css";
import Images from "@/constants/Images";
import Button from "@/components/ui/Button";
import Version from "@/components/Version/Version";
import { useNavigate } from "react-router-dom";
import { useDataStore } from "@/stores/appStore";
import Cookies from "js-cookie";
import { useTranslation } from "react-i18next";
import {
  Bike, ChevronDown, Download, FileSpreadsheet, Globe, Info, LifeBuoy, LogIn, LogOut,
  Mail, Menu, MessageCircle, Palette, Smartphone, Timer, X,
} from "lucide-react";
// Relative: tsconfig only aliases specific "@/…" prefixes, and config isn't one.
import { VERSION } from "../../../config/index";
import { SUPPORTED_LANGUAGES } from "../../../i18n/i18n";
import RiderFlag from "../../../race/components/riderFlag/RiderFlag";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { useSkin, type Skin } from "@/hooks/useSkin";
import { useJokerMode } from "@/hooks/useJokerMode";
import { BOARD_HOLD_OPTIONS, useBoardHold } from "@/stores/boardHoldStore";
import { usePwaInstall, isIos } from "@/components/pwa/usePwaInstall";
import { toast } from "react-toastify";

const THEME_OPTIONS: { value: Theme; labelKey: string; label: string; bg: string; accent: string }[] = [
  { value: 'light',    labelKey: 'prefs.themeLight', label: 'Light', bg: '#f5f8fc', accent: '#63a6fc' },
  { value: 'dark',     labelKey: 'prefs.themeDark',  label: 'Dark',  bg: '#161b22', accent: '#63a6fc' },
  { value: 'contrast', labelKey: 'prefs.themeSun',   label: 'Sun',   bg: '#ffffff', accent: '#0057ff' },
];

/** Where side-menu feedback lands. */
const FEEDBACK_EMAIL = "info@commissaire.us";

const SKIN_OPTIONS: { value: Skin; label: string; bg: string; radius: string }[] = [
  { value: 'classic', label: 'Classic', bg: 'linear-gradient(145deg, #63a6fc, #4a8ee7)', radius: '4px' },
  { value: 'gaming',  label: 'Pro',     bg: 'linear-gradient(145deg, #1d3d78, #e0a92c)', radius: '1px' },
];

/** The board hold that ships as default (boardHoldStore). */
const DEFAULT_HOLD_MS = 2000;

const MENU_BUTTON_ID = "main-menu-button";

type PrefSection = 'appearance' | 'language' | 'timing';

/** Small ⓘ button that reveals a longer explanation on tap instead of keeping
 *  the paragraph on screen. Click, not hover, so it works on touch. */
function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
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

function HeaderMain() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openSection, setOpenSection] = useState<PrefSection | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const { user, getUser } = useDataStore();
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { skin, setSkin } = useSkin();
  const { jokerEnabled, toggleJokerEnabled } = useJokerMode();
  const { holdMs, setHoldMs } = useBoardHold();
  const { hasNativePrompt, installed, promptInstall } = usePwaInstall();

  useEffect(() => {
    getUser();
  }, []);

  const closeDrawer = () => {
    setDrawerOpen(false);
    document.getElementById(MENU_BUTTON_ID)?.focus();
  };

  // Keyboard: focus moves into the drawer on open, Escape closes it.
  useEffect(() => {
    if (!drawerOpen) return;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const handleLogout = () => {
    Cookies.remove("token");
    Cookies.remove("user");
    useDataStore.setState({ user: null, token: null });
    setDrawerOpen(false);
  };

  const handleInstall = async () => {
    if (hasNativePrompt) {
      await promptInstall();
    } else {
      // No native prompt (iOS, or the browser hasn't offered one):
      // tell the user where the browser keeps the install action.
      toast.info(
        isIos()
          ? "Tap the Share button, then “Add to Home Screen”."
          : "Open the browser menu (⋮) and choose “Install app” / “Add to Home screen”.",
        { autoClose: 8000 }
      );
    }
    setDrawerOpen(false);
  };

  const toggleSection = (s: PrefSection) =>
    setOpenSection(cur => (cur === s ? null : s));

  const currentLang =
    SUPPORTED_LANGUAGES.find(l => l.code === i18n.resolvedLanguage) ?? SUPPORTED_LANGUAGES[0];
  const themeOpt = THEME_OPTIONS.find(o => o.value === theme) ?? THEME_OPTIONS[0];
  const skinOpt = SKIN_OPTIONS.find(o => o.value === skin) ?? SKIN_OPTIONS[0];
  const seconds = (ms: number) => t("prefs.seconds", "{{n}} s", { n: ms / 1000 });

  // One-line value shown on a collapsed section header.
  const summaries: Record<PrefSection, string> = {
    appearance: `${t(themeOpt.labelKey, themeOpt.label)} · ${t(`prefs.skin.${skinOpt.value}`, skinOpt.label)}`,
    language: currentLang.label,
    timing: seconds(holdMs),
  };

  /** Collapsible preference group: header button + body, one open at a time. */
  const section = (key: PrefSection, icon: React.ReactNode, title: string, body: React.ReactNode) => {
    const open = openSection === key;
    const bodyId = `prefs-${key}-body`;
    return (
      <div className={`${styles.prefSection} ${open ? styles.prefSectionOpen : ''}`}>
        <button
          type="button"
          className={styles.prefHeader}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => toggleSection(key)}
          data-testid={`prefs-${key}`}
        >
          <span className={styles.prefIcon} aria-hidden="true">{icon}</span>
          <span className={styles.prefTitle}>{title}</span>
          {!open && <span className={styles.prefSummary} dir="auto">{summaries[key]}</span>}
          <ChevronDown className={styles.prefChevron} aria-hidden="true" />
        </button>
        {open && (
          <div id={bodyId} className={styles.prefBody} role="group" aria-label={title}>
            {body}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className={styles.main}>
        <Button
          id={MENU_BUTTON_ID}
          variant="icon"
          size="md"
          iconOnly
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          aria-controls="main-side-menu"
          onClick={() => setDrawerOpen(true)}
          className={styles.navIconBtn}
        >
          <Menu className={styles.navIcon} aria-hidden="true" />
        </Button>
        <div className={styles.head}>
          <span className={styles.headMain}>Commissaire</span>
          <span className={styles.headSub}>focus the race not the paper</span>
        </div>
        <div className={styles.right}>
          <Button
            variant="icon"
            size="md"
            iconOnly
            aria-label="Messages"
            className={styles.msgBtn}
          >
            <MessageCircle className={styles.msgIcon} aria-hidden="true" />
          </Button>
          <img
            src={Images.user}
            alt="user"
            width={40}
            height={40}
            className={styles.user}
          />
        </div>
      </div>

      {/* Overlay */}
      {drawerOpen && (
        <div className={styles.overlay} onClick={closeDrawer} />
      )}

      {/* Drawer */}
      <aside
        id="main-side-menu"
        className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("nav.menu", "Menu")}
      >
        {/* 1 · Header */}
        <div className={styles.drawerHeader}>
          <div className={styles.drawerTitleContainer}>
            <div className={styles.drawerTitle}>Commissaire</div>
            <div className={styles.drawerSlogan}>focus the race not the paper</div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            aria-label="Close menu"
            onClick={closeDrawer}
            className={styles.closeBtn}
          >
            <X className={styles.closeIcon} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.drawerScroll}>
          {/* 2 · Account — exactly one action: sign in for guests, sign out otherwise */}
          <div className={styles.account}>
            <img src={Images.user} alt="" className={styles.avatarImg} />
            <div className={styles.accountText}>
              <div className={styles.avatarName} dir="auto">
                {user ? (user.familyName || user.name) : t("nav.guest", "Guest")}
              </div>
              <div className={styles.avatarSub} dir="auto">
                {user ? (user.phone || t("nav.signedIn", "Signed in")) : t("nav.notSignedIn", "Not signed in")}
              </div>
            </div>
          </div>
          <div className={styles.accountActions}>
            {user ? (
              <button type="button" className={styles.accountAction} onClick={handleLogout}>
                <LogOut aria-hidden="true" />
                <span>{t("nav.logout", "Logout")}</span>
              </button>
            ) : (
              <button
                type="button"
                className={styles.accountAction}
                onClick={() => {
                  setDrawerOpen(false);
                  navigate("/login");
                }}
              >
                <LogIn aria-hidden="true" />
                <span>{t("nav.registerLogin", "Register / Login")}</span>
                <span className={styles.soonBadge}>{t("login.soon", "Soon")}</span>
              </button>
            )}
          </div>

          {/* 3 · Main navigation */}
          <nav className={styles.drawerNav} aria-label={t("nav.mainNav", "Main")}>
            <button
              type="button"
              className={styles.navItem}
              onClick={() => {
                setDrawerOpen(false);
                navigate("/main");
              }}
            >
              <Bike className={styles.navItemIcon} aria-hidden="true" />
              <span>{t("nav.myRaces", "My Races")}</span>
            </button>
            {/* Downloadable Excel start-list template — fill in your riders, then
                import it. Served from public/ so it must go through BASE_URL. */}
            <a
              className={styles.navItem}
              href={`${import.meta.env.BASE_URL}start-list-template.xlsx`}
              download="start-list-template.xlsx"
              onClick={() => setDrawerOpen(false)}
            >
              <FileSpreadsheet className={styles.navItemIcon} aria-hidden="true" />
              <span>{t("nav.downloadTemplate", "Download start-list template")}</span>
            </a>
            <button
              type="button"
              className={styles.navItem}
              onClick={() => {
                setDrawerOpen(false);
                navigate("/contact");
              }}
            >
              <LifeBuoy className={styles.navItemIcon} aria-hidden="true" />
              <span>{t("nav.contactSupport", "Contact & Support")}</span>
            </button>
          </nav>

          {/* 4 · Preferences — collapsed by default, one open at a time */}
          <div className={styles.groupLabel}>{t("nav.preferences", "Preferences")}</div>
          <div className={styles.prefs}>
            {section('appearance', <Palette />, t("prefs.appearance", "Appearance"), (
              <>
                <div className={styles.fieldLabel} id="prefs-theme-label">{t("prefs.theme", "Theme")}</div>
                <div className={styles.segmented} role="group" aria-labelledby="prefs-theme-label">
                  {THEME_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={styles.segment}
                      aria-pressed={theme === opt.value}
                      aria-label={`${opt.label} theme`}
                      onClick={() => setTheme(opt.value)}
                    >
                      <span
                        className={styles.swatch}
                        style={{ background: `linear-gradient(135deg, ${opt.bg} 55%, ${opt.accent} 55%)` }}
                        aria-hidden="true"
                      />
                      {t(opt.labelKey, opt.label)}
                    </button>
                  ))}
                </div>
                <div className={styles.fieldLabel} id="prefs-skin-label">{t("prefs.buttonStyle", "Button style")}</div>
                <div className={styles.segmented} role="group" aria-labelledby="prefs-skin-label">
                  {SKIN_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={styles.segment}
                      aria-pressed={skin === opt.value}
                      aria-label={`${opt.label} button style`}
                      onClick={() => setSkin(opt.value)}
                    >
                      <span
                        className={styles.swatch}
                        style={{ background: opt.bg, borderRadius: opt.radius }}
                        aria-hidden="true"
                      />
                      {t(`prefs.skin.${opt.value}`, opt.label)}
                    </button>
                  ))}
                </div>
              </>
            ))}

            {section('language', <Globe />, t("prefs.language", "Language"), (
              <div className={styles.selectRow}>
                <span className={styles.selectFlag} aria-hidden="true">
                  <RiderFlag flag={currentLang.flag} size={22} />
                </span>
                <select
                  className={styles.select}
                  value={currentLang.code}
                  onChange={(e) => i18n.changeLanguage(e.target.value)}
                  aria-label={t("prefs.language", "Language")}
                  data-testid="language-select"
                >
                  {SUPPORTED_LANGUAGES.map(opt => (
                    <option key={opt.code} value={opt.code}>{opt.label}</option>
                  ))}
                </select>
              </div>
            ))}

            {section('timing', <Timer />, t("prefs.timing", "Timing & Live Controls"), (
              <>
                {/* Joker — instant time+arrival stamp for riders the commissaire
                    can't identify fast enough, resolved to a bib later */}
                <div className={styles.settingRow}>
                  <label className={styles.settingLabel} htmlFor="prefs-joker">
                    {t("prefs.joker", "Joker button")}
                  </label>
                  <InfoTip label={t("prefs.aboutJoker", "About the Joker button")}>
                    {t("prefs.jokerInfo", "Shows a Joker button on the live wave screen. Tap it to stamp a rider's arrival time instantly when you can't read their bib in time — assign the bib afterward.")}
                  </InfoTip>
                  <input
                    id="prefs-joker"
                    type="checkbox"
                    className={styles.switch}
                    checked={jokerEnabled}
                    onChange={toggleJokerEnabled}
                    aria-label={t("prefs.jokerAria", "Show Joker button on the live wave screen")}
                  />
                </div>
                {/* Board hold — stops the live board reshuffling under the
                    commissaire while a whole bunch is being called out. Also on
                    the live screen's settings gear, so it can be retuned mid-wave. */}
                <div className={styles.settingRow}>
                  <label className={styles.settingLabel} htmlFor="prefs-board-hold">
                    {t("prefs.boardHold", "Board hold")}
                  </label>
                  <InfoTip label={t("prefs.aboutBoardHold", "About board hold")}>
                    {t("prefs.boardHoldInfo", "When riders arrive in a bunch, tapped cards stay put — marked with a green ✓ — and all drop to the bottom together once {{n}} seconds pass with no new tap. Stops the board reshuffling while you're still reading bibs.", { n: holdMs / 1000 })}
                  </InfoTip>
                  <select
                    id="prefs-board-hold"
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
              </>
            ))}
          </div>

          {/* 5 · Footer */}
          <div className={styles.drawerFooter}>
            {!installed && (
              <button type="button" className={styles.footerBtn} onClick={handleInstall}>
                <Smartphone aria-hidden="true" />
                <span>{t("nav.installApp", "Install app")}</span>
                <Download className={styles.footerBtnTrail} aria-hidden="true" />
              </button>
            )}
            <div className={styles.footerMeta}>
              {/* Direct line to the author — feedback goes to a person, not a form */}
              <a
                className={styles.feedbackLink}
                href={`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
                  `Commissaire ${VERSION} — feedback`
                )}`}
                title={t("nav.feedbackHint", "Comments? Bugs? Please write — every message is read.")}
              >
                <Mail aria-hidden="true" />
                <span>{FEEDBACK_EMAIL}</span>
              </a>
              <span className={styles.footerVersion}>
                <Version />
              </span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

export default HeaderMain;
