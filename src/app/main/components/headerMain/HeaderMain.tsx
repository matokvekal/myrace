import React, { useState } from "react";
import styles from "./headerMain.module.css";
import Icons from "@/constants/Icons";
import Images from "@/constants/Images";
import { useNavigate } from "react-router-dom";

function HeaderMain() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <div className={styles.main}>
        <img
          src={Icons.mainNav}
          alt="menu"
          width={24}
          height={24}
          onClick={() => setDrawerOpen(true)}
          className={styles.navIcon}
        />
        <div className={styles.head}>commissaire</div>
        <div className={styles.right}>
          <img src={Icons.mainMsg} alt="messages" width={24} height={24} />
          <img src={Images.user} alt="user" width={40} height={40} className={styles.user} />
        </div>
      </div>

      {/* Overlay */}
      {drawerOpen && (
        <div className={styles.overlay} onClick={() => setDrawerOpen(false)} />
      )}

      {/* Drawer */}
      <div className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ""}`}>
        <div className={styles.drawerHeader}>
          <div className={styles.drawerTitle}>commissaire</div>
          <img
            src={Icons.closetip}
            alt="close"
            width={20}
            height={20}
            onClick={() => setDrawerOpen(false)}
            className={styles.closeBtn}
          />
        </div>

        <div className={styles.drawerAvatar}>
          <img src={Images.user} alt="user" className={styles.avatarImg} />
          <div className={styles.avatarName}>Guest</div>
          <div className={styles.avatarSub}>Not signed in</div>
        </div>

        <nav className={styles.drawerNav}>
          <button
            className={styles.navItem}
            onClick={() => { setDrawerOpen(false); navigate("/login"); }}
          >
            <img src={Icons.rider1} alt="" width={20} height={20} />
            Register / Login
          </button>
          <button
            className={styles.navItem}
            onClick={() => { setDrawerOpen(false); navigate("/contact"); }}
          >
            <img src={Icons.mainMsg} alt="" width={20} height={20} />
            Contact
          </button>
          <button
            className={styles.navItem}
            onClick={() => { setDrawerOpen(false); navigate("/main"); }}
          >
            <img src={Icons.bike} alt="" width={20} height={20} />
            My Races
          </button>
        </nav>
      </div>
    </>
  );
}

export default HeaderMain;
