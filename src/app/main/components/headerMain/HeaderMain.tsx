import React, { useState, useEffect } from "react";
import styles from "./headerMain.module.css";
import Images from "@/constants/Images";
import Button from "@/components/ui/Button";
import Version from "@/components/Version/Version";
import { useNavigate } from "react-router-dom";
import { useDataStore } from "@/stores/appStore";
import Cookies from "js-cookie";
import { useTranslation } from "react-i18next";
import { Bike, Download, Gamepad2, Globe, LogOut, Mail, Menu, MessageCircle, Palette, Timer, UserRound, X } from "lucide-react";
// Relative: tsconfig only aliases specific "@/…" prefixes, and config isn't one.
import { VERSION } from "../../../config/index";
import { SUPPORTED_LANGUAGES } from "../../../i18n/i18n";
import RiderFlag from "../../../race/components/riderFlag/RiderFlag";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { useSkin, type Skin } from "@/hooks/useSkin";
import { useJokerMode } from "@/hooks/useJokerMode";
import { BOARD_HOLD_OPTIONS, useBoardHold } from "@/stores/boardHoldStore";
import { usePwaInstall } from "@/components/pwa/usePwaInstall";

const THEME_OPTIONS: { value: Theme; label: string; bg: string; accent: string; text: string }[] = [
  { value: 'light',    label: 'Light',    bg: '#f5f8fc', accent: '#63a6fc', text: '#14243c' },
  { value: 'dark',     label: 'Dark',     bg: '#161b22', accent: '#63a6fc', text: '#e4e9f0' },
  { value: 'contrast', label: 'Sun',      bg: '#ffffff', accent: '#0057ff', text: '#000000' },
];

/** Where side-menu feedback lands. */
const FEEDBACK_EMAIL = "info@commissaire.us";

const SKIN_OPTIONS: { value: Skin; label: string; bg: string; radius: string }[] = [
  { value: 'classic', label: 'Classic', bg: 'linear-gradient(145deg, #63a6fc, #4a8ee7)', radius: '10px' },
  { value: 'gaming',  label: 'PRO',  bg: 'linear-gradient(145deg, #1d3d78, #e0a92c)', radius: '3px' },
];

function HeaderMain() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const { user, getUser } = useDataStore();
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { skin, setSkin } = useSkin();
  const { jokerEnabled, toggleJokerEnabled } = useJokerMode();
  const { holdMs, setHoldMs } = useBoardHold();
  const { canInstall, promptInstall } = usePwaInstall();

  useEffect(() => {
    getUser();
  }, []);

  const handleLogout = () => {
    Cookies.remove("token");
    Cookies.remove("user");
    useDataStore.setState({ user: null, token: null });
    setDrawerOpen(false);
  };

  return (
    <>
      <div className={styles.main}>
        <Button
          variant="icon"
          size="md"
          iconOnly
          aria-label="Open menu"
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
        <div className={styles.overlay} onClick={() => setDrawerOpen(false)} />
      )}

      {/* Drawer */}
      <div
        className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ""}`}
      >
        <div className={styles.drawerHeader}>
          <div className={styles.drawerTitleContainer}>
            <div className={styles.drawerTitle}>Commissaire</div>
            <div className={styles.drawerSlogan}>focus the race not the paper</div>
          </div>
          <Button
            variant="icon"
            size="md"
            iconOnly
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className={styles.closeBtn}
          >
            <X className={styles.closeIcon} aria-hidden="true" />
          </Button>
        </div>

        <div className={styles.drawerScroll}>
        <div className={styles.drawerAvatar}>
          <img src={Images.user} alt="user" className={styles.avatarImg} />
          {user ? (
            <>
              <div className={styles.avatarName}>
                {user.familyName || user.name}
              </div>
              <div className={styles.avatarSub}>{user.phone}</div>
            </>
          ) : (
            <>
              <div className={styles.avatarName}>{t("nav.guest", "Guest")}</div>
              <div className={styles.avatarSub}>{t("nav.notSignedIn", "Not signed in")}</div>
            </>
          )}
        </div>

        <nav className={styles.drawerNav}>
          {user ? (
            <Button
              variant="ghost"
              size="lg"
              className={styles.navItem}
              onClick={handleLogout}
            >
              <LogOut className={styles.navItemIcon} aria-hidden="true" />
              {t("nav.logout", "Logout")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="lg"
              className={styles.navItem}
              onClick={() => {
                setDrawerOpen(false);
                navigate("/login");
              }}
            >
              <UserRound className={styles.navItemIcon} aria-hidden="true" />
              {t("nav.registerLogin", "Register / Login")}
              <span className={styles.soonBadge}>{t("login.soon", "Soon")}</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="lg"
            className={styles.navItem}
            onClick={() => {
              setDrawerOpen(false);
              navigate("/contact");
            }}
          >
            <MessageCircle className={styles.navItemIcon} aria-hidden="true" />
            {t("nav.contact", "Contact")}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className={styles.navItem}
            onClick={() => {
              setDrawerOpen(false);
              navigate("/main");
            }}
          >
            <Bike className={styles.navItemIcon} aria-hidden="true" />
            {t("nav.myRaces", "My Races")}
          </Button>
          {/* Downloadable Excel start-list template — fill in your riders, then
              import it. Served from public/ so it must go through BASE_URL. */}
          <a
            className={`${styles.navItem} ${styles.navItemLink}`}
            href={`${import.meta.env.BASE_URL}start-list-template.xlsx`}
            download="start-list-template.xlsx"
            onClick={() => setDrawerOpen(false)}
          >
            <Download className={styles.navItemIcon} aria-hidden="true" />
            {t("nav.downloadTemplate", "Download start-list template")}
          </a>
          {canInstall && (
            <Button
              variant="ghost"
              size="lg"
              className={styles.navItem}
              onClick={async () => {
                await promptInstall();
                setDrawerOpen(false);
              }}
            >
              <Download className={styles.navItemIcon} aria-hidden="true" />
              Install app
            </Button>
          )}
        </nav>

        {/* Theme picker */}
        <div className={styles.themeSection}>
          <div className={styles.themeSectionLabel}>
            <Palette className={styles.themeSectionIcon} aria-hidden="true" />
            Appearance
          </div>
          <div className={styles.themeOptions}>
            {THEME_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={styles.themeOption}
                onClick={() => setTheme(opt.value)}
                aria-label={`${opt.label} theme`}
                title={opt.label}
              >
                <span
                  className={`${styles.themeSwatch} ${theme === opt.value ? styles.themeSwatchActive : ''}`}
                  style={{ background: opt.bg }}
                >
                  <span
                    className={styles.themeSwatchStripe}
                    style={{ background: opt.accent }}
                  />
                  <span
                    className={styles.themeSwatchDot}
                    style={{ background: opt.text }}
                  />
                </span>
                <span className={`${styles.themeLabel} ${theme === opt.value ? styles.themeLabelActive : ''}`}>
                  {opt.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Language picker */}
        <div className={styles.themeSection}>
          <div className={styles.themeSectionLabel}>
            <Globe className={styles.themeSectionIcon} aria-hidden="true" />
            Language
          </div>
          <div className={styles.languageGrid}>
            {SUPPORTED_LANGUAGES.map(opt => (
              <button
                key={opt.code}
                className={styles.languageOption}
                onClick={() => i18n.changeLanguage(opt.code)}
                aria-label={opt.label}
                title={opt.label}
              >
                <span
                  className={`${styles.languageFlag} ${i18n.resolvedLanguage === opt.code ? styles.languageFlagActive : ''}`}
                >
                  <RiderFlag flag={opt.flag} size={38} />
                </span>
                <span className={`${styles.themeLabel} ${i18n.resolvedLanguage === opt.code ? styles.themeLabelActive : ''}`}>
                  {opt.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Button style picker */}
        <div className={styles.themeSection}>
          <div className={styles.themeSectionLabel}>
            <Gamepad2 className={styles.themeSectionIcon} aria-hidden="true" />
            Button Style
          </div>
          <div className={styles.themeOptions}>
            {SKIN_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={styles.themeOption}
                onClick={() => setSkin(opt.value)}
                aria-label={`${opt.label} button style`}
                title={opt.label}
              >
                <span
                  className={`${styles.themeSwatch} ${skin === opt.value ? styles.themeSwatchActive : ''}`}
                  style={{ background: opt.bg, borderRadius: opt.radius }}
                />
                <span className={`${styles.themeLabel} ${skin === opt.value ? styles.themeLabelActive : ''}`}>
                  {opt.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Joker button toggle — instant time+arrival stamp for riders the
            commissaire can't identify fast enough, resolved to a bib later */}
        <div className={styles.themeSection}>
          <div className={styles.themeSectionLabel}>
            <Bike className={styles.themeSectionIcon} aria-hidden="true" />
            Joker Button
          </div>
          <label className={styles.jokerToggleRow}>
            <input
              type="checkbox"
              checked={jokerEnabled}
              onChange={toggleJokerEnabled}
            />
            <span>Show Joker button on the live wave screen</span>
          </label>
          <p className={styles.jokerToggleDesc}>
            Tap it to stamp a rider's arrival time instantly when you can't
            read their bib in time — assign the bib afterward.
          </p>
        </div>

        {/* Board hold — stops the live board reshuffling under the commissaire
            while a whole bunch is being called out. Also on the live screen's
            settings gear, so it can be retuned mid-wave. */}
        <div className={styles.themeSection}>
          <div className={styles.themeSectionLabel}>
            <Timer className={styles.themeSectionIcon} aria-hidden="true" />
            Board Hold
          </div>
          <select
            className={styles.boardHoldSelect}
            value={holdMs}
            onChange={(e) => setHoldMs(Number(e.target.value))}
            aria-label="Board hold delay"
          >
            {BOARD_HOLD_OPTIONS.map((ms) => (
              <option key={ms} value={ms}>
                {ms / 1000} seconds{ms === 2000 ? ' (default)' : ''}
              </option>
            ))}
          </select>
          <p className={styles.jokerToggleDesc}>
            When riders arrive in a bunch, tapped cards stay put — marked with a
            green ✓ — and all drop to the bottom together once {holdMs / 1000}{' '}
            seconds pass with no new tap. Stops the board reshuffling while
            you're still reading bibs.
          </p>
        </div>

        {/* Direct line to the author — feedback goes to a person, not a form */}
        <div className={styles.feedbackSection}>
          <div className={styles.feedbackTitle}>
            <Mail className={styles.feedbackIcon} aria-hidden="true" />
            Comments? Bugs?
          </div>
          <p className={styles.feedbackText}>
            Please write me — I read everything. Thanks!
          </p>
          <a
            className={styles.feedbackLink}
            href={`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
              `Commissaire ${VERSION} — feedback`
            )}`}
          >
            {FEEDBACK_EMAIL}
          </a>
        </div>

        {/* Version lives here in the side menu */}
        <div className={styles.drawerFooter}>
          <Version />
        </div>
        </div>
      </div>
    </>
  );
}

export default HeaderMain;
