import { Link } from "react-router-dom";
import "./error.module.css";
import bg from "../assets/images/loginBg.png";
import styles from "./error.module.css";
import Icons from "@/constants/Icons";
import Footer from "@/components/Footer/Footer";
import { useNavigate } from "react-router-dom";

export default function LoginError() {
  const navigate = useNavigate();
  const handleBack = () => {
    navigate("/main");
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        background: "rgba(255, 255, 255, 0.9)",
        backgroundImage: `url(${bg})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        overflow: "hidden",
      }}
    >
      <div className={styles.wrapper}>
        <div className={styles.arrow} onClick={handleBack}>
          <img src={Icons.arrowback} alt="Back" width={24} height={24} />
        </div>
        <div className={styles.logo}>
          <img src={Icons.arrowback} alt="error" width={110} height={70} />
        </div>
        <div className={styles.title}>Error</div>
        <div className={styles.message}>
          <p>
            We&apos;re sorry, but it seems there was an error. Please check the
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
        <div className={styles.link} onClick={handleBack}>
          <Link to="/">TRY AGAIN</Link>
        </div>
        <Footer />
      </div>
    </div>
  );
}
