import { useNavigate } from "react-router-dom";
import ArcadeTopbar from "@/components/arcade/ArcadeTopbar";
import Footer from "@/components/Footer/Footer";
import "@/styles/arcade.css";
import styles from "./contact.module.css";

const CONTACT_EMAIL = "mictavim@gmail.com";

const CHANNELS = [
  {
    accent: "pink",
    icon: "🐛",
    title: "Found a Bug?",
    text: "Something broke mid-race? Tell us what happened and on which screen — we'll hunt it down.",
    action: "Report a Bug",
    href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
      "Commissaire — Bug Report"
    )}`,
  },
  {
    accent: "blue",
    icon: "💡",
    title: "Feature Idea?",
    text: "Commissaires know best what race day needs. Pitch a feature and help shape the roadmap.",
    action: "Send an Idea",
    href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
      "Commissaire — Feature Idea"
    )}`,
  },
  {
    accent: "amber",
    icon: "🏁",
    title: "Say Hi",
    text: "Running races with Commissaire? We'd love to hear your race-day stories from the field.",
    action: "Write to Us",
    href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
      "Commissaire — Hello"
    )}`,
  },
];

const ContactPage = () => {
  const navigate = useNavigate();

  return (
    <div className={`${styles.page} arcadeTheme`}>
      <ArcadeTopbar />

      <div className={styles.content}>
        <div className={styles.head}>
          <div className={styles.kicker}>PIT WALL · OPEN CHANNEL</div>
          <h1 className={styles.title}>Contact</h1>
          <p className={styles.lead}>
            Radio in — bugs, ideas or just a checkered-flag hello.
          </p>
        </div>

        <div className={styles.channels}>
          {CHANNELS.map((channel) => (
            <div
              className={`${styles.card} ${styles[channel.accent]}`}
              key={channel.title}
            >
              <span className={styles.icon} aria-hidden="true">
                {channel.icon}
              </span>
              <h2>{channel.title}</h2>
              <p>{channel.text}</p>
              <a className={styles.cardAction} href={channel.href}>
                {channel.action} ▸
              </a>
            </div>
          ))}
        </div>

        <button className={styles.backCta} onClick={() => navigate("/")}>
          ◂ Back to Start Line
        </button>
      </div>

      <Footer />
    </div>
  );
};

export default ContactPage;
