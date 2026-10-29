import { useEffect, useState } from "react";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

/** Toast colour scheme for the app theme set on <html data-theme> (useTheme). */
function toastTheme(): "light" | "dark" {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "dark" || t === "night" ? "dark" : "light";
}

/**
 * The single toast host for the whole app. Every `toast.*` call in the app
 * renders here; before this was mounted, those messages were never shown.
 * Bottom-centre so it never covers the live screen's bib search at the top.
 */
export function AppToasts() {
  const [theme, setTheme] = useState(toastTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(toastTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <ToastContainer
      position="bottom-center"
      autoClose={2500}
      hideProgressBar
      newestOnTop
      closeOnClick
      pauseOnFocusLoss={false}
      limit={3}
      theme={theme}
      rtl={false}
    />
  );
}

export default AppToasts;
