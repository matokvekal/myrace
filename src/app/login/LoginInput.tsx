import React, { useState } from "react";
import styles from "./loginInput.module.css";

interface CustomInputProps {
  label: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  name?: string;
}

const CustomInput: React.FC<CustomInputProps> = ({
  label,
  type = "text",
  value,
  onChange,
  error,
}) => {
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  const getInputClassName = () => {
    if (error) return `${styles.input} ${styles.error}`;
    if (isFocused) return `${styles.input} ${styles.typing}`;
    return `${styles.input} ${styles.empty}`;
  };

  const getLabelClassName = () => {
    if (isFocused) return `${styles.label} ${styles.typingLabel}`;
    return `${styles.label}`;
  };
  const shouldShowLabel = !value && !isFocused;
  return (
    <div className={styles.inputContainer}>
      {!shouldShowLabel && (
        <label className={styles.label} htmlFor={label}>
          {label}
        </label>
      )}
      <input
        id={label}
        className={getInputClassName()}
        type={type}
        value={value}
        onChange={onChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={value.length === 0 && !isFocused ? label : ""}
      />
      {error && <p className={styles.errorMessage}>{error}</p>}
    </div>
  );
};

export default CustomInput;
