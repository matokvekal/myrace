import styles from "./login.module.css";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useDataStore } from "@/stores/appStore";
import { validateForm } from "@/utils/loginValidation";
import ArcadeTopbar from "@/components/arcade/ArcadeTopbar";
import Footer from "@/components/Footer/Footer";
import "@/styles/arcade.css";
import LoginInput from "./LoginInput";

/* Accounts / OTP need a backend that isn't live yet (roadmap Phase 2+4).
   Flip to true once sign-up works — the whole form re-enables itself. */
const LOGIN_ENABLED = false;

const LoginPage = () => {
  const navigate = useNavigate();
  const signUp = useDataStore((state) => state.handleSignUp);
  const setLoginState = useDataStore((state) => state.setLoginState);
  const getUser = useDataStore((state) => state.getUser);

  const [formData, setFormData] = useState({
    familyName: "",
    parentPhone: "",
    email: "",
    readAndAgreeTerms: false
  });

  const [error, setError] = useState<string | any>(null);
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});

  const isFormIncomplete = useMemo(
    () =>
      !formData.familyName ||
      !formData.parentPhone ||
      !formData.email ||
      !formData.readAndAgreeTerms,
    [formData]
  );

  useEffect(() => {
    const checkUser = async () => {
      if (await getUser()) {
        navigate("/main");
      }
    };
    checkUser();
  }, [getUser, navigate]);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const { name, value, type, checked } = event.target;
      setFormData((prev) => ({
        ...prev,
        [name]: type === "checkbox" ? checked : value
      }));
    },
    []
  );

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!LOGIN_ENABLED || isFormIncomplete) return;

    setError(null);
    const errors = validateForm(formData);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    try {
      const res = await signUp(formData);
      if (res.status === 200) {
        setLoginState("otp");
        navigate(`/otp?message=${encodeURIComponent("OTP was sent")}`);
      } else if (res.status === 429) {
        setError(
          "Too many OTP attempts. Please wait 15 minutes before trying again."
        );
      } else {
        setError(res?.data || "Sign up failed");
        navigate(`/loginerror?message=${encodeURIComponent(error)}`);
      }
    } catch (err) {
      console.error("Sign up failed", err);
      setError("Sign up failed. Please check your details and try again.");
      navigate(
        `/loginerror?message=${encodeURIComponent(
          "Sign up failed. Please check your details and try again."
        )}`
      );
    }
  };

  return (
    <div className={`${styles.page} arcadeTheme`}>
      <ArcadeTopbar />

      <div className={styles.content}>
        <div className={styles.card}>
          <div className={styles.soonRibbon}>Soon</div>

          <div className={styles.cardHead}>
            <div className={styles.kicker}>PLAYER PROFILE</div>
            <h1 className={styles.title}>Sign Up</h1>
            <p className={styles.lead}>
              Accounts and cloud sync are on the roadmap. Until then the whole
              app runs <strong>free on your device</strong> — no sign-up
              needed.
            </p>
          </div>

          {error && <p className={styles.serverError}>{error}</p>}

          <form onSubmit={handleSignUp} className={styles.form}>
            <fieldset
              className={styles.fieldset}
              disabled={!LOGIN_ENABLED}
              aria-label={
                LOGIN_ENABLED ? undefined : "Sign-up coming soon (disabled)"
              }
            >
              <LoginInput
                label="Surname"
                name="familyName"
                value={formData.familyName}
                onChange={handleChange}
                error={formErrors.familyName}
              />
              <LoginInput
                label="Phone number"
                name="parentPhone"
                type="tel"
                value={formData.parentPhone}
                onChange={handleChange}
                error={formErrors.parentPhone}
              />
              <LoginInput
                label="Email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                error={formErrors.email}
              />

              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  name="readAndAgreeTerms"
                  checked={formData.readAndAgreeTerms}
                  onChange={handleChange}
                />
                <span>
                  I agree to the <em>terms of use</em> and{" "}
                  <em>privacy policy</em>
                </span>
              </label>
              {formErrors.readAndAgreeTerms && (
                <p className={styles.error}>{formErrors.readAndAgreeTerms}</p>
              )}

              <button
                className={styles.submit}
                type="submit"
                disabled={!LOGIN_ENABLED || isFormIncomplete}
              >
                {LOGIN_ENABLED ? "Create Account" : "Coming Soon"}
              </button>
            </fieldset>
          </form>

          <div className={styles.divider}>
            <span>meanwhile</span>
          </div>

          <button className={styles.playCta} onClick={() => navigate("/main")}>
            ▶ Start Racing — No Account
          </button>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default LoginPage;
