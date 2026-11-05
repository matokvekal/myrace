import { useNavigate } from "react-router-dom";
import styles from "./landingV2.module.css";

const liveScreenshot = `${import.meta.env.BASE_URL}images/Capture.PNG`;

const CHIPS = [
  "One tap = one lap",
  "Live standings",
  "Works offline",
];

export default function LandingV2Page() {
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <div className={styles.logoLockup}>
          <span className={styles.logoMain}>Commissaire</span>
          <span className={styles.logoSub}>Bike Race</span>
        </div>
      </div>

      <div className={styles.heroRow}>
        <div className={styles.hero}>
          <h1 className={styles.headline}>
            Race day.
            <br />
            <span className={styles.headlineAccent}>One tap</span> per lap.
          </h1>
          <p className={styles.tagline}>
            Timing, check-in and live standings for MTB &amp; gravel events —
            built for dust, mud and no signal.
          </p>
          <button className={styles.cta} onClick={() => navigate("/main")}>
            Enter the App
          </button>
          <div className={styles.chips}>
            {CHIPS.map((chip) => (
              <div className={styles.chip} key={chip}>
                <span className={styles.chipDot} />
                {chip}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.phoneWrap}>
          <div className={styles.phone}>
            <img
              className={styles.phoneScreen}
              src={liveScreenshot}
              alt="Commissaire live heat screen — race clock and tap-to-record rider grid"
            />
          </div>
          <div className={styles.liveBadge}>
            <span className={styles.chipDot} />
            LIVE
          </div>
          <div className={styles.lapChip}>00:00:16</div>
        </div>
      </div>

      <div className={styles.footer}>
        <button className={styles.altLink} onClick={() => navigate("/")}>
          View classic landing page
        </button>
        <span className={styles.note}>Commissaire — MTB &amp; Gravel officiating</span>
      </div>
    </div>
  );
}
