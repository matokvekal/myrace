import { useNavigate } from "react-router-dom";
import { TERMS_SECTIONS, TERMS_EFFECTIVE_DATE, TERMS_VERSION } from "../legal/terms";
import styles from "./terms.module.css";

/** Full Terms & Conditions page (BUGS.md #16). Content lives in @/legal/terms. */
const TermsPage = () => {
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <button className={styles.back} onClick={() => navigate(-1)}>
          ◂ Back
        </button>

        <h1 className={styles.title}>Terms &amp; Conditions</h1>
        <p className={styles.meta}>
          Effective {TERMS_EFFECTIVE_DATE} · version {TERMS_VERSION}
        </p>
        <p className={styles.draftNote}>
          Draft standard terms — replace with your own reviewed text.
        </p>

        {TERMS_SECTIONS.map((section) => (
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

export default TermsPage;
