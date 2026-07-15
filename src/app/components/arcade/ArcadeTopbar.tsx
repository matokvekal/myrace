import { Link } from "react-router-dom";
import styles from "./arcadeTopbar.module.css";

const cubeLogo = `${import.meta.env.BASE_URL}logo.png`;

/** Brand bar for the public "arcade" pages (landing / sign-up / contact). */
function ArcadeTopbar() {
  return (
    <div className={styles.topbar}>
      <Link to="/" className={styles.lockup} aria-label="Commissaire home">
        <img className={styles.cube} src={cubeLogo} alt="" />
        <span className={styles.wordmark}>
          Commissaire
          <span className={styles.sub}>Race Control</span>
        </span>
      </Link>
      <Link to="/contact" className={styles.navLink}>
        Contact
      </Link>
    </div>
  );
}

export default ArcadeTopbar;
