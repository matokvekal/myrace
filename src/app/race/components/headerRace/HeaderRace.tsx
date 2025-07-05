import React from "react";
import PropTypes from "prop-types";
import styles from "./headerRace.module.css";
import Image from "next/image";
import Icons from "@/constants/Icons";
import { useRouter } from "next/navigation";

function HeaderRace() {
  const router = useRouter();

  const handleBack = () => { 
    router.push("/main"); // Navigate to the main page
  };

  return (
    <div className={styles.headerRace}>
      <div className={styles.left}>
        <Image
          src={Icons.arrowLeft}
          alt="back"
          width={34}
          height={34}
          onClick={handleBack}
        />
      </div>
      <div className={styles.right}>
        <Image src={Icons.threeDots} alt="menu" width={34} height={34} />
      </div>
    </div>
  );
}

export default HeaderRace;
