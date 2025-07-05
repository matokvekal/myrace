"use client";
// import HeaderLogo from "@/components/headerLogo/HeaderLogo";
import Link from "next/link";
import "./error.module.css";
import bg from "../assets/images/loginBg.png";
import styles from "./error.module.css";
import Image from "next/image";
import Icons from "@/constants/Icons";
import Footer from "@/components/Footer/Footer";
import { useRouter } from "next/navigation";

export default function LoginError() {
  const router = useRouter();
  const handleBack = () => { 
    router.push("/main"); 
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        background: "rgba(255, 255, 255, 0.9)",
        backgroundImage: `url(${bg.src})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",

        overflow: "hidden",
      }}
    >
      <div className={styles.wrapper}>
        <div className={styles.arrow} onClick={handleBack}>
          <Image src={Icons.arrowback} alt="Back" width={24} height={24} />
        </div>
        <div className={styles.logo}>
          <Image src={Icons.arrowback} alt="error" width={110} height={70} />
        </div>
        <div className={styles.title}>Error</div>
        <div className={styles.message}>
          <p>
            We&apos; re sorry, but it seems there was an error. Please check the
            following:
          </p>
        </div>
        <div className={styles.submessage}>
          <p>
            1.Ensure you have a stable internet connection. Confirm your login
            credentials are correct.
          </p>
          <p>2. Confirm your login credentials are correct.</p>
        </div>

        <div className={styles.link}   onClick={handleBack}>
          <Link href="/">TRY AGAIN</Link>
        </div>
        <Footer />
      </div>
    </div>
  );
}
