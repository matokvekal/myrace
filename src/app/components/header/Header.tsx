import React from "react";
import Icons from "@/constants/Icons";
import Images from "@/constants/Images";
import styles from "./header.module.css";
import useUIStore from "@/stores/uiStore";

const Header = () => {
  const { modals, openModal, closeModal } = useUIStore();
  return (
    <div className={styles.header}>
      <div className={styles.left}>
        <div className={styles.logo}>
          <img src={Icons.logo} alt="logo" width={118} height={24} />
        </div>
      </div>
      <div className={styles.right}>
        <div className={styles.info}>
          <img src={Icons.bike} alt="info" width={20} height={20} />
        </div>
        {/* <div className={styles.burger} onClick={() => openMenu()}>
          <Image src={Icons.menu} alt="menu" width={24} height={24} />
        </div> */}
      </div>
    </div>
  );
};

export default Header;
