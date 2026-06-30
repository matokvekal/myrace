"use client";

import { useEffect } from "react";
import { loadClubDictionaryFromFile } from "@/utils/dictionaryLoader";
import { seedDemoRace } from "@/utils/demoSeed";

export default function DictionaryInitializer() {
  useEffect(() => {
    loadClubDictionaryFromFile();
    seedDemoRace();
  }, []);

  return null;
}
