"use client";

import { useEffect } from "react";
import { seedDemoRace } from "@/utils/demoSeed";

export default function DictionaryInitializer() {
  useEffect(() => {
    seedDemoRace();
  }, []);

  return null;
}
