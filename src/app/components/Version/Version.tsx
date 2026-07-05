import React from "react";
import styles from "./version.module.css";

const Version: React.FC = () => {
  const version = import.meta.env.VITE_APP_VERSION || "dev";

  return (
    <div className={styles.versionBadge} title="App version">
      v{version}
    </div>
  );
};

export default Version;
