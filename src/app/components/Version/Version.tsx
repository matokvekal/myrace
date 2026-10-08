import React from "react";
import styles from "./version.module.css";
// Single source of truth for the app version: edit src/app/version.json before
// each release. `VITE_APP_VERSION` (if set at build time) still wins as an
// override, e.g. to stamp a CI build number.
import versionInfo from "../../version.json";

const Version: React.FC = () => {
  const version = import.meta.env.VITE_APP_VERSION || versionInfo.version || "dev";

  return (
    <div className={styles.versionBadge} title={`App version${versionInfo.date ? ` · ${versionInfo.date}` : ""}`}>
      v{version}
    </div>
  );
};

export default Version;
