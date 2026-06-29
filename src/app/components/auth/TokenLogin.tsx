/**
 * TokenLogin Component
 *
 * Simple login form where users paste their token to authenticate.
 * Admin generates tokens and shares them with commissaires.
 */

"use client";

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import styles from "./tokenLogin.module.css";

export interface TokenLoginProps {
  /** Redirect path after successful login (default: '/main') */
  redirectTo?: string;

  /** Optional callback after successful login */
  onSuccess?: () => void;
}

export const TokenLogin: React.FC<TokenLoginProps> = ({
  redirectTo = "/main",
  onSuccess
}) => {
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();

  const [token, setToken] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if already authenticated
  React.useEffect(() => {
    if (isAuthenticated) {
      navigate(redirectTo);
    }
  }, [isAuthenticated, redirectTo, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token.trim()) {
      setError("Please enter your token");
      return;
    }

    setIsLoading(true);

    try {
      const success = await login(token);

      if (success) {
        console.log("Login successful");
        onSuccess?.();
        navigate(redirectTo);
      } else {
        setError("Invalid token. Please check and try again.");
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("Login failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setToken(text);
      setError(null);
    } catch (err) {
      console.error("Failed to read clipboard:", err);
      setError("Failed to paste from clipboard");
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1 className={styles.title}>🏁 Commissaire Login</h1>
          <p className={styles.subtitle}>Enter your access token to continue</p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.inputGroup}>
            <label htmlFor="token" className={styles.label}>
              Access Token
            </label>
            <div className={styles.inputWrapper}>
              <textarea
                id="token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your token here..."
                className={styles.textarea}
                rows={4}
                disabled={isLoading}
                autoFocus
              />
              <button
                type="button"
                onClick={handlePaste}
                className={styles.pasteButton}
                disabled={isLoading}
                title="Paste from clipboard"
              >
                📋 Paste
              </button>
            </div>
          </div>

          {error && (
            <div className={styles.error}>
              <span className={styles.errorIcon}>⚠️</span>
              {error}
            </div>
          )}

          <button
            type="submit"
            className={styles.submitButton}
            disabled={isLoading || !token.trim()}
          >
            {isLoading ? "Logging in..." : "Login"}
          </button>
        </form>

        <div className={styles.footer}>
          <p className={styles.footerText}>
            Don't have a token? Contact your race administrator.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TokenLogin;
