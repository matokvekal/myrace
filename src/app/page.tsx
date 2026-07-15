import { useNavigate } from "react-router-dom";
import ArcadeTopbar from "@/components/arcade/ArcadeTopbar";
import Footer from "@/components/Footer/Footer";
import "@/styles/arcade.css";
import styles from "./landing.module.css";

const cubeLogo = `${import.meta.env.BASE_URL}logo.png`;
const liveScreenshot = `${import.meta.env.BASE_URL}images/Capture.PNG`;

const FEATURES = [
  {
    level: "LV.01",
    accent: "blue",
    title: "Live Lap Recording",
    text: "Tap-to-record splits for every rider, with instant DNF / DSQ / DNS handling and one-tap revert.",
  },
  {
    level: "LV.02",
    accent: "amber",
    title: "Wave & Heat Management",
    text: "Group riders into waves, run staggered starts, and track each category's own start clock.",
  },
  {
    level: "LV.03",
    accent: "pink",
    title: "Real-Time Standings",
    text: "Positions recalculate live as laps come in — built for the chaos of the finish line.",
  },
  {
    level: "LV.04",
    accent: "cream",
    title: "CSV Import & Club Dictionary",
    text: "Bring in rider lists in seconds, with smart column mapping and Hebrew/English club matching.",
  },
];

const TICKER = [
  "LAP 3/5",
  "RIDER 233 ON COURSE",
  "+00:12.4",
  "WAVE B — GO!",
  "POSITIONS LIVE",
  "DNF 0 · DSQ 0",
  "FINAL LAP — RING THE BELL",
];

export default function LandingPage() {
  const navigate = useNavigate();

  const handleEnter = () => {
    navigate("/main");
  };

  const tickerLine = TICKER.map((item) => `${item}  ✦  `).join("");

  return (
    <div className={`${styles.page} arcadeTheme`}>
      <ArcadeTopbar />

      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.badge}>MTB &amp; GRAVEL RACE OFFICIATING</div>
          <h1 className={styles.title}>
            <span className={styles.titleBlue}>Ready.</span>
            <span className={styles.titleAmber}>Set.</span>
            <span className={styles.titlePink}>Race.</span>
          </h1>
          <p className={styles.subtitle}>
            The race-day toolkit for commissaires running mountain bike and
            gravel events — check-in, timing, and live standings, built for
            dust, mud, and no signal.
          </p>
          <button className={styles.cta} onClick={handleEnter}>
            ▶ Press Start
          </button>
          <p className={styles.ctaHint}>
            Free · Works offline · No account needed
          </p>
        </div>

        <div className={styles.heroStage}>
          <div className={styles.orbit} />
          <span className={`${styles.spark} ${styles.sparkBlue}`}>＋</span>
          <span className={`${styles.spark} ${styles.sparkPink}`}>▲</span>
          <span className={`${styles.spark} ${styles.sparkAmber}`}>●</span>
          <img
            className={styles.cube}
            src={cubeLogo}
            alt="Commissaire rider cube — rider number, lap timer and race status"
          />
          <div className={styles.cubeShadow} />
        </div>
      </div>

      <div className={styles.ticker} aria-hidden="true">
        <div className={styles.tickerTrack}>
          <span>{tickerLine}</span>
          <span>{tickerLine}</span>
        </div>
      </div>

      <div className={styles.levels}>
        <h2 className={styles.sectionTitle}>Level Select</h2>
        <p className={styles.sectionSub}>
          Everything you need to run race day, stage by stage.
        </p>
        <div className={styles.features}>
          {FEATURES.map((feature) => (
            <div
              className={`${styles.card} ${styles[feature.accent]}`}
              key={feature.title}
            >
              <span className={styles.cardLevel}>{feature.level}</span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.feed}>
        <div className={styles.screenFrame}>
          <div className={styles.screenBar}>
            <span className={styles.screenDots}>
              <i /><i /><i />
            </span>
            <span className={styles.screenLabel}>LIVE FEED · HEAT 2</span>
            <span className={styles.rec}>
              <i className={styles.recDot} />REC
            </span>
          </div>
          <div className={styles.screen}>
            <img
              src={liveScreenshot}
              alt="Commissaire live heat screen — rider tiles with lap counts and timing"
            />
          </div>
        </div>
      </div>

      <div className={styles.finalCta}>
        <h2 className={styles.finalTitle}>Ready to race?</h2>
        <button className={styles.cta} onClick={handleEnter}>
          ▶ Enter the App
        </button>
      </div>

      <Footer />
    </div>
  );
}
