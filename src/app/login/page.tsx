import styles from "./login.module.css";
import HeaderLogo from "@/components/headerLogo/HeaderLogo";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useDataStore } from "@/stores/appStore";
import { validateForm } from "@/utils/loginValidation";
import Footer from "@/components/Footer/Footer";
import bg from "../assets/images/loginBg.png";
import LoginInput from "./LoginInput";

const LoginPage = () => {
  const navigate = useNavigate();
  const signUp = useDataStore((state) => state.handleSignUp);
  const setLoginState = useDataStore((state) => state.setLoginState);
  const getUser = useDataStore((state) => state.getUser);

  // ✅ Use a single state object to manage form inputs
  const [formData, setFormData] = useState({
    familyName: "",
    parentPhone: "",
    email: "",
    readAndAgreeTerms: false
  });

  const [error, setError] = useState<string | any>(null);
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});

  // ✅ Memoize `isFormIncomplete` instead of maintaining another state
  const isFormIncomplete = useMemo(
    () =>
      !formData.familyName ||
      !formData.parentPhone ||
      !formData.email ||
      !formData.readAndAgreeTerms,
    [formData]
  );

  // ✅ UseEffect for checking user authentication
  useEffect(() => {
    const checkUser = async () => {
      if (await getUser()) {
        navigate("/main");
      }
    };
    checkUser();
  }, [getUser, navigate]);

  // ✅ Centralized change handler to update form state dynamically
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

  // ✅ Form submission logic
  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isFormIncomplete) return;

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
    <div
      className={styles.container}
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        background: "rgba(255, 255, 255, 0.9)",
        backgroundImage: `url(${bg})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        display: "flex",
        justifyContent: "center",
        overflow: "hidden"
      }}
    >
      <div className={styles.logowrapper}>
        <HeaderLogo />
      </div>
      <div className={styles.titlewrapper}>
        <div className={styles.titleUp}>Sign Up</div>
        <div className={styles.titleBottom}>Nice to see you!</div>
      </div>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <form onSubmit={handleSignUp} className={styles.form}>
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

        <div className={styles.formControler}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              name="readAndAgreeTerms"
              checked={formData.readAndAgreeTerms}
              onChange={handleChange}
            />
            <span>I</span>
            <span className={styles.agreeColor}>agree to the terms</span>
            <span> of use and</span>
            <span className={styles.agreeColor}>privacy policy</span>
          </label>
          {formErrors.readAndAgreeTerms && (
            <p className={styles.error}>{formErrors.readAndAgreeTerms}</p>
          )}
        </div>

        <button
          className={`${
            isFormIncomplete ? styles.submitNotReady : styles.submitReady
          } ${styles.submit}`}
          type="submit"
          disabled={isFormIncomplete}
        >
          SUBMIT
        </button>
      </form>
      <Footer />
    </div>
  );
};

export default LoginPage;
