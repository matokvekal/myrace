import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VoiceSettings, VoiceCommand, Language } from '../types/voice.types';

interface VoiceSettingsStore {
  settings: VoiceSettings;
  commands: VoiceCommand[];
  updateSettings: (patch: Partial<VoiceSettings>) => void;
  setLanguage: (language: Language) => void;
  setAutoConfirm: (autoConfirm: boolean) => void;
  setEnabled: (enabled: boolean) => void;
}

const defaultSettings: VoiceSettings = {
  // Voice isn't proven reliable yet: OFF until switched on in Race Setup. The Live mic
  // icon only shows when this is on.
  enabled: false,
  language: 'he',
  model: 'webspeech',
  // Off by default: "assist" mode — spoken bibs just fill the voice buffer for
  // the commissaire to review, nothing gets recorded automatically. Safe to
  // default this way (unlike flipping a live feature) — autoConfirm was
  // previously unwired everywhere, so this had zero effect until now.
  autoConfirm: false,
};

const defaultCommands: VoiceCommand[] = [];

export const useVoiceSettingsStore = create<VoiceSettingsStore>()(
  persist(
    (set) => ({
      settings: defaultSettings,
      commands: defaultCommands,
      updateSettings: (patch) =>
        set((state) => ({
          settings: { ...state.settings, ...patch },
        })),
      setLanguage: (language) =>
        set((state) => ({
          settings: { ...state.settings, language },
        })),
      setAutoConfirm: (autoConfirm) =>
        set((state) => ({
          settings: { ...state.settings, autoConfirm },
        })),
      setEnabled: (enabled) =>
        set((state) => ({
          settings: { ...state.settings, enabled },
        })),
    }),
    {
      name: 'voice-settings-store',
      // v1: `enabled` defaults to OFF. Before v1 no screen could change it, so a stored
      // `true` is only the old default — reset it (language / auto-record are kept).
      version: 1,
      migrate: (persisted, version) => {
        const s = persisted as { settings?: VoiceSettings } | undefined;
        if (version < 1 && s?.settings) s.settings = { ...s.settings, enabled: false };
        return s as unknown as VoiceSettingsStore;
      },
      storage: typeof window !== 'undefined' ?
        {
          getItem: (name) => {
            const item = localStorage.getItem(name);
            return item ? JSON.parse(item) : null;
          },
          setItem: (name, value) => {
            localStorage.setItem(name, JSON.stringify(value));
          },
          removeItem: (name) => {
            localStorage.removeItem(name);
          },
        } : undefined,
    }
  )
);
