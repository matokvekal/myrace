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
  enabled: true,
  language: 'he',
  model: 'webspeech',
  autoConfirm: true,
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
