"use client";
import Image from "next/image";
import Icons from "@/constants/Icons";
import Images from "@/constants/Images";
import React from "react";
import styles from "./splash.module.css"; // Import your custom CSS file for styling
import Footer from "@/components/Footer/Footer";

const SplashScreen = () => {
  return (
    <div className={styles.container}>
      <div className={styles.image}>
        <Image
          src={Images.bikeMountainSplash}
          alt="Parent Illustration"
          layout="fill"
          objectFit="cover"
          quality={100}
        />
        <div className={styles.overlay}>
          <Image
            src={Images.bikeMountainSplash}
            alt="bike"
            width={180}
            height={173}
            quality={100}
          />
          <div className={styles.title2}>Commissaire</div>
        </div>

      </div>
      <Footer />
    </div>
  );
};

export default SplashScreen;
