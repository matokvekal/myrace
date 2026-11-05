import React, { useState } from "react";
import styles from "./info.module.css";

/** One short line, with the full explanation one tap away. */
const MoreText: React.FC<{ lead: string; testId?: string; children: React.ReactNode }> = ({ lead, testId, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={styles.moreLead}>
        <span className={styles.moreLeadText}>{lead}</span>
        <button
          type="button"
          className={styles.moreBtn}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          data-testid={testId}
        >
          {open ? "Less" : "More…"}
        </button>
      </div>
      {open && <div className={styles.moreDetails}>{children}</div>}
    </>
  );
};

export default MoreText;
