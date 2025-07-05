"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Cookies from "js-cookie";
import useUIStore from "@/stores/uiStore";
import SplashScreen from "./splash/page";

export default function HomePage() {
  const [initialCheckCompleted, setInitialCheckCompleted] = useState(false);
  const openModal = useUIStore((state) => state.openModal);
  const closeModal = useUIStore((state) => state.closeModal);
  const modals = useUIStore((state) => state.modals);
  const router = useRouter();

  useEffect(() => {
    openModal("showSplash");
    const token = Cookies.get("token");
    // Register the service worker when the component is mounted
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js")
          .then((registration) => {
            console.log(
              "Service Worker registered with scope:",
              registration.scope
            );
          })
          .catch((err) => {
            console.log("Service Worker registration failed:", err);
          });
      });
    }
    // Delay navigation and splash screen removal for 1 seconds
    const timer = setTimeout(() => {
      closeModal("showSplash");

      if (!token) {
      } else {
        router.push("/main");
      }

      setInitialCheckCompleted(true);
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  return modals.showSplash && !initialCheckCompleted ? <SplashScreen /> : null;
}
