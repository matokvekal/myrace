import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect
} from "react";
import styles from "./otpbox.module.css";
import { useDataStore } from "@/stores/appStore";
import { useNavigate } from "react-router-dom";

const ERROR_MESSAGES = {
  INCOMPLETE: "Please enter all 4 digits",
  SERVER_ERROR: "Server error",
  TIME_PASSED: "Confirmation code time passed",
  INCORRECT_CODE: "Confirmation code is not correct",
  NO_USER: "No user found"
};

const COOLDOWN_TIME = 30; // 30 seconds cooldown

const OtpBox: React.FC = () => {
  const [otp, setOtp] = useState<string[]>(Array(4).fill(""));
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [clear, setClear] = useState(true);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const handleSendOtp = useDataStore((state) => state.handleSendOtp);
  const setLoginState = useDataStore((state) => state.setLoginState);
  const loginState = useDataStore((state) => state.loginState);
  const navigate = useNavigate();
  const [counter, setCounter] = useState(0);
  const [submitButtonClass, setSubmitButtonClass] = useState(
    styles.submitNotReady
  );
  const [isFormIncomplete, setIsFormIncomplete] = useState(true);

  useEffect(() => {
    if (loginState === "main") {
      navigate("/main");
    } else if (loginState === "login" || !loginState) {
      navigate("/login");
    }
  }, [loginState, navigate]);

  useEffect(() => {
    if (otp.includes("") || isLoading) {
      setIsFormIncomplete(true);
      setSubmitButtonClass(styles.submitNotReady);
    } else {
      setIsFormIncomplete(false);
      setSubmitButtonClass(styles.submitReady);
    }
  }, [otp, isLoading]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
      const { value } = e.target;
      if (/^\d$/.test(value) || value === "") {
        setOtp((prev) => {
          const newOtp = [...prev];
          newOtp[index] = value;
          return newOtp;
        });
        setError("");
        if (value !== "" && index < 3) {
          inputRefs.current[index + 1]?.focus();
        }
      }
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
      if (e.key === "Backspace" && otp[index] === "") {
        const prev = Math.max(index - 1, 0);
        inputRefs.current[prev]?.focus();
      }
    },
    [otp]
  );

  const handleSend = async () => {
    setClear(false);
    if (counter > 3) {
      setLoginState("login");
    }

    setCounter(counter + 1);
    if (otp.includes("") || isLoading) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const res = await handleSendOtp(otp.join(""));

      switch (res.status) {
        case 200:
          setLoginState("main");
          //  router.push("/main");
          break;
        case 500:
          setError(ERROR_MESSAGES.SERVER_ERROR);
          break;
        case 400:
          setError(ERROR_MESSAGES.TIME_PASSED);
          break;
        case 401:
          setError(ERROR_MESSAGES.INCORRECT_CODE);
          setOtp(Array(4).fill(""));
          setCounter((prev) => prev + 1);
          break;
        case 402:
          setError(ERROR_MESSAGES.NO_USER);
          break;
        default:
          setLoginState("login");
      }
    } catch (error) {
      setError(ERROR_MESSAGES.SERVER_ERROR);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = useCallback(() => {
    setOtp(Array(4).fill(""));
    setError("");
    setClear(true);
    inputRefs.current[0]?.focus();
  }, []);

  const renderInputs = useMemo(
    () =>
      otp.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          type="tel"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(e, index)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          className={`${styles.input}  ${error ? styles.rebBorder : ""}`}
          aria-label={`Digit ${index + 1}`}
        />
      )),
    [otp, error, handleChange, handleKeyDown]
  );

  return (
    <div className={styles.container}>
      <div className={`${styles.box} ${error ? styles.errorBox : ""}`}>
        {renderInputs}
      </div>
      {error && <div className={styles.errorMessage}>{error}</div>}
      {/* <div className={styles.buttons}> */}
      {/* <button
          className={`${styles.button} ${styles.sendButton}`}
          onClick={handleSend}
          disabled={isLoading || !clear || otp.includes("")}
        >
          {isLoading ? "Sending..." : "Ok"}
        </button> */}
      <button
        className={`${submitButtonClass} ${styles.submit}`}
        type="submit"
        disabled={isFormIncomplete}
        onClick={handleSend}
      >
        SUBMIT
      </button>
      {/* <button
          className={`${styles.button} ${styles.cancelButton}`}
          onClick={handleCancel}
        >
          Clear
        </button> */}
      {/* </div> */}
    </div>
  );
};

export default OtpBox;
