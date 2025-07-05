"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./otp.module.css";
import Image from "next/image";
import HeaderLogo from "@/components/headerLogo/HeaderLogo";
import Footer from "@/components/Footer/Footer";
import OtpBox from "@/components/otpbox/OtpBox";
import bg from "../assets/images/loginBg.png";
import Icons from "@/constants/Icons";
import Loader from "@/components/Loader";
import { useDataStore } from "@/stores/appStore";

const Otp = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("");
  const user = useDataStore((state) => state.user);
  const [hiddenPhone, setHiddenPhone] = useState("*********");

  useEffect(() => {
    if (user && user.phone) {
      // Format the phone number to hide some digits
      const formattedPhone = user.phone.replace(
        /(\d{3})(\d{2})(\d{2})(\d{2})/,
        "$1****$4"
      );
      setHiddenPhone(formattedPhone);
    } else {
      // If no phone number, redirect to login
      // router.push("/login");
    }  
    router.push("/main");
  }, [user, router]);

  useEffect(() => {
    if (searchParams) {
      const messageParam = searchParams.get("message");
      if (messageParam) {
        setMessage(messageParam);
      }
    }
  }, [searchParams]);

  const handleBack = () => {  
    router.push("/main"); // Navigate to the main page
  };

  return (
    <div
      className={styles.container}
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        background: "rgba(255, 255, 255, 0.9)",
        backgroundImage: `url(${bg.src})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        display: "flex",
        // alignItems: "flex-end",
        justifyContent: "center",
        overflow: "hidden"
      }}
    >
      <div className={styles.backButton} onClick={handleBack}>
        <Image src={Icons.arrowback} alt="Back" width={24} height={24} />
      </div>
      {/* <div className={styles.wrapper}> */}
      <div className={styles.logowrapper}>
        <HeaderLogo />
      </div>
      <div className={styles.titlewrapper}>
        <div className={styles.titleUp}>Sign Up</div>
        <div className={styles.titleMiddle}>Nice to see you!</div>
        <div className={styles.bottom1}>We sent an SMS message to</div>
        <div className={styles.bottom2}>the phone number:{hiddenPhone}</div>
      </div>
      <div className={styles.otpbox}>
        <OtpBox />
      </div>
      <div className={styles.sendagain}>
        <p>Didn&apos;t receive the code?</p> <strong>Send again</strong>
      </div>
      <Footer />
    </div>
    // </div>
  );
};

const OtpPage = () => (
  <Suspense fallback={<Loader />}>
    <Otp />
  </Suspense>
);

export default OtpPage;
