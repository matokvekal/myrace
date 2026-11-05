import React from "react";
import styles from "./loader.module.css";

/**
 * App loading spinner. Pure CSS on purpose (BUGS.md #1): this used to pull in
 * `@mui/material` + `@emotion` for a single spinner, which dominated the initial
 * bundle. Same look, no dependency.
 */
const Loader: React.FC = () => (
  <div className={styles.wrap}>
    <div className={styles.spinner} role="status" aria-label="Loading" />
  </div>
);

export default Loader;
