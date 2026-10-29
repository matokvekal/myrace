import { useNavigate } from "react-router-dom";
import { PRIVACY_SECTIONS, PRIVACY_EFFECTIVE_DATE, PRIVACY_VERSION } from "../legal/privacy";
import styles from "./privacy.module.css";

/** Full Privacy Policy page. Content lives in @/legal/privacy. */
const PrivacyPage = () => {
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <button className={styles.back} onClick={() => navigate(-1)}>
          ◂ Back
        </button>

        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.meta}>
          Effective {PRIVACY_EFFECTIVE_DATE} · version {PRIVACY_VERSION}
        </p>
        <p className={styles.draftNote}>
          Draft privacy policy — replace with your own reviewed text.
        </p>

        {PRIVACY_SECTIONS.map((section) => (
          <section key={section.heading} className={styles.section}>
            <h2 className={styles.heading}>{section.heading}</h2>
            {section.body.map((para, i) => (
              <p key={i} className={styles.para}>
                {para}
              </p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
};

export default PrivacyPage;
