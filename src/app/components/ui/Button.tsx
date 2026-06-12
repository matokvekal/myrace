import React from "react";
import styles from "./button.module.css";

type ButtonVariant = "primary" | "success" | "secondary" | "icon" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  fullWidth?: boolean;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  size = "md",
  iconOnly = false,
  fullWidth = false,
  startIcon,
  endIcon,
  className = "",
  children,
  ...props
}) => {
  const classes = [
    styles.btn,
    styles[variant],
    styles[size],
    iconOnly ? styles.iconOnly : "",
    fullWidth ? styles.fullWidth : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} {...props}>
      {startIcon ? <span className={styles.slotIcon}>{startIcon}</span> : null}
      {children ? <span className={styles.label}>{children}</span> : null}
      {endIcon ? <span className={styles.slotIcon}>{endIcon}</span> : null}
    </button>
  );
};

export default Button;
