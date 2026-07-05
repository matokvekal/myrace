import React, { useState, useEffect } from "react";
import styles from "./headerMain.module.css";
import Images from "@/constants/Images";
import Button from "@/components/ui/Button";
import Version from "@/components/Version/Version";
import { useNavigate } from "react-router-dom";
import { useDataStore } from "@/stores/appStore";
import Cookies from "js-cookie";
import { Bike, LogOut, Menu, MessageCircle, Palette, UserRound, X } from "lucide-react";
import { useTheme, type Theme } from "@/hooks/useTheme";

const THEME_OPTIONS: { value: Theme; label: string; bg: string; accent: string; text: string }[] = [
  { value: 'light',    label: 'Light',    bg: '#f5f8fc', accent: '#63a6fc', text: '#14243c' },
  { value: 'dark',     label: 'Dark',     bg: '#161b22', accent: '#63a6fc', text: '#e4e9f0' },
  { value: 'contrast', label: 'Sun',      bg: '#ffffff', accent: '#0057ff', text: '#000000' },
  { value: 'warm',     label: 'Warm',     bg: '#fbf3e0', accent: '#c87400', text: '#2d1810' },
  { value: 'night',    label: 'Night',    bg: '#040812', accent: '#00c8ff', text: '#d2ebff' },
];

function HeaderMain() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const { user, getUser } = useDataStore();
  const { theme, setTheme } = useTheme();

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
        <div className={styles.head}>Commissire - Bike Race</div>
        <div className={styles.right}>
          <Version />
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
          <div className={styles.drawerTitle}>Commissire - Bike Race</div>
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
              <div className={styles.avatarName}>Guest</div>
              <div className={styles.avatarSub}>Not signed in</div>
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
              Logout
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
              Register / Login
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
            Contact
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
            My Races
          </Button>
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
      </div>
    </>
  );
}

export default HeaderMain;
