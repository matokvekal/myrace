import React, { useState, useEffect } from "react";
import styles from "./headerMain.module.css";
import Images from "@/constants/Images";
import Button from "@/components/ui/Button";
import { useNavigate } from "react-router-dom";
import { useDataStore } from "@/stores/appStore";
import Cookies from "js-cookie";
import { Bike, LogOut, Menu, MessageCircle, UserRound, X } from "lucide-react";

function HeaderMain() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const { user, getUser } = useDataStore();

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
        <div className={styles.head}>commissaire</div>
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
          <div className={styles.drawerTitle}>commissaire</div>
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
      </div>
    </>
  );
}

export default HeaderMain;
