import Icons from "@/constants/Icons";
import Images from "@/constants/Images";
import React from "react";
import styles from "./splash.module.css";
import Footer from "@/components/Footer/Footer";

const SplashScreen = () => {
  return (
    <div className={styles.container}>
      <div className={styles.image} style={{ position: "relative" }}>
        <img
          src={Images.bikeMountainSplash}
          alt="Parent Illustration"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
        <div className={styles.overlay}>
          <img
            src={Images.bikeMountainSplash}
            alt="bike"
            width={180}
            height={173}
          />
          <div className={styles.title2}>Commissaire</div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default SplashScreen;
