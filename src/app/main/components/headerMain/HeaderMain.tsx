import React from "react";
import PropTypes from "prop-types";
import styles from "./headerMain.module.css";
import Image from "next/image";
import Icons from "@/constants/Icons";
import Images from "@/constants/Images";

function HeaderMain() {
  return (
    <div className={styles.main}>
      <Image src={Icons.mainNav} alt="menu" width={24} height={24} />
      <div className={styles.head}>commissaire</div>
      <div className={styles.right}>
        <Image src={Icons.mainMsg} alt="menu" width={24} height={24} />
        <Image src={Images.user} alt="menu" width={40} height={40} className={styles.user}/>
      </div>
    </div>
  );
}

export default HeaderMain;
