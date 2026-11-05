import { useEffect, useRef, useState } from 'react';
import { pickBibsFromAlternatives } from '@/utils/numberParser';
import type { Language, VoiceCommand } from '@/types/voice.types';

interface VoiceRecognitionOptions {
  language: Language;
  validBibs: Set<string>;
  commands: VoiceCommand[];
  onBibDetected: (bib: string) => void;
  onCommand: (action: string) => void;
  enabled: boolean;
}

interface VoiceRecognitionReturn {
  isListening: boolean;
  audioLevel: number;
  lastTranscript: string;
  /** Recognition runs on the device (works offline) rather than in the cloud. */
  onDevice: boolean;
}

/** Guesses requested per phrase; the bib list picks the right one (see pickBibsFromAlternatives). */
const MAX_ALTERNATIVES = 5;
/** Boost for the race's bibs in contextual biasing. */
const BIB_PHRASE_BOOST = 3.0;
/** Keep the biasing list bounded — the browser may reject a huge one. */
const MAX_BIB_PHRASES = 500;

/**
 * Contextual biasing (`recognition.phrases`, Chrome-only, experimental): tells
 * the recognizer which numbers are racing so it prefers them over sound-alikes.
 * Feature-detected — a browser without it keeps the old behaviour.
 */
function applyBibPhrases(recognition: any, validBibs: Set<string>) {
  const Phrase = (window as any).SpeechRecognitionPhrase;
  if (!Phrase || !('phrases' in recognition)) return;
  try {
    recognition.phrases = [...validBibs]
      .slice(0, MAX_BIB_PHRASES)
      .map((bib) => new Phrase(bib, BIB_PHRASE_BOOST));
  } catch (_) {
    // Unsupported on this browser version — recognition still works without it.
  }
}

/**
 * On-device recognition (`processLocally`, experimental): no audio leaves the
 * phone, so it keeps working with no signal on course and answers faster. Only
 * used when the language model is ALREADY installed — we never start a model
 * download mid-race. Anything else falls back to the browser's cloud engine.
 */
async function canProcessLocally(SpeechRecognition: any, lang: string): Promise<boolean> {
  if (typeof SpeechRecognition?.available !== 'function') return false;
  try {
    const status = await SpeechRecognition.available({ langs: [lang], processLocally: true });
    return status === 'available';
  } catch (_) {
    return false;
  }
}

export function useVoiceRecognition(options: VoiceRecognitionOptions): VoiceRecognitionReturn {
  const { language, validBibs, commands, onBibDetected, onCommand, enabled } = options;

  const recognitionRef    = useRef<any>(null);
  const enabledRef        = useRef(enabled);
  const languageRef       = useRef(language);
  const validBibsRef      = useRef(validBibs);
  const commandsRef       = useRef(commands);
  const onBibDetectedRef  = useRef(onBibDetected);
  const onCommandRef      = useRef(onCommand);
  // Debounce "not connected" so brief stop/restarts don't flash in the UI
  const listeningOffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isListening,    setIsListening]    = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [audioLevel]                        = useState(0);
  const [onDevice,       setOnDevice]       = useState(false);

  // Sync all mutable refs on every render — no extra effects needed
  enabledRef.current       = enabled;
  languageRef.current      = language;
  validBibsRef.current     = validBibs;
  commandsRef.current      = commands;
  onBibDetectedRef.current = onBibDetected;
  onCommandRef.current     = onCommand;

  // Main effect: only restarts when enabled or language changes — not on callback / bib changes
  useEffect(() => {
    if (!enabled) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        setIsListening(false);
      }
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('Speech Recognition not supported in this browser');
      return;
    }

    const lang = language === 'en' ? 'en-US' : 'he-IL';
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    let disposed = false;

    recognition.continuous      = true;
    recognition.interimResults  = true;
    recognition.maxAlternatives = MAX_ALTERNATIVES;
    recognition.lang            = lang;

    // (Re)start with the current bib list as the biasing hint — bibs added
    // mid-wave are picked up on the next restart, which Chrome does about
    // once a minute anyway.
    const start = () => {
      if (disposed || !enabledRef.current) return;
      applyBibPhrases(recognition, validBibsRef.current);
      try {
        recognition.start();
      } catch (_) {
        // Still shutting down from the previous session — try again shortly.
        setTimeout(() => {
          if (disposed || !enabledRef.current) return;
          try { recognition.start(); } catch (_) {}
        }, 250);
      }
    };

    recognition.onstart = () => {
      if (listeningOffTimer.current) clearTimeout(listeningOffTimer.current);
      setIsListening(true);
    };

    recognition.onend = () => {
      // Debounce "not connected" — Chrome restarts within ~300ms, so only flip
      // the indicator if it stays stopped for over 1 second
      listeningOffTimer.current = setTimeout(() => setIsListening(false), 1000);

      if (disposed || !enabledRef.current) return;
      // Restart straight away: Chrome ends a session after silence or ~60s, and
      // a bib called during a restart gap is simply lost.
      start();
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'aborted') return;
      // 'no-speech' is normal — Chrome fires this after silence; let onend handle restart
      if (event.error === 'no-speech') return;
      console.error('Speech recognition error:', event.error);
      // For fatal errors (not-allowed, network) stop trying to restart
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        enabledRef.current = false;
        setIsListening(false);
        return;
      }
      // On-device engine refused this language/session — use the cloud engine
      // for the rest of the session (onend restarts it).
      if (recognition.processLocally && (event.error === 'language-not-supported' || event.error === 'phrases-not-supported')) {
        recognition.processLocally = false;
        setOnDevice(false);
      }
    };

    recognition.onresult = (event: any) => {
      try {
        // Several phrases can finalize in ONE event when bibs are called fast —
        // walk every result that changed (from resultIndex), not just the last.
        for (let i = event.resultIndex ?? 0; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result?.[0]) continue;

          const transcript = result[0].transcript || '';
          if (!transcript.trim()) continue;
          setLastTranscript(transcript);
          if (!result.isFinal) continue;

          const lowerTranscript = transcript.toLowerCase().trim();

          // Commands first
          const cmd = commandsRef.current.find((c) =>
            c.trigger.some((t) => lowerTranscript.includes(t.toLowerCase()))
          );
          if (cmd) {
            onCommandRef.current(cmd.action);
            continue;
          }

          // Bibs — choose among the recognizer's guesses using the real bib list
          const alternatives: string[] = [];
          for (let a = 0; a < result.length; a++) {
            if (result[a]?.transcript) alternatives.push(result[a].transcript);
          }
          for (const bib of pickBibsFromAlternatives(alternatives, languageRef.current, validBibsRef.current)) {
            onBibDetectedRef.current(bib);
          }
        }
      } catch (error) {
        console.error('Error processing speech result:', error);
      }
    };

    // Prefer on-device when its model is already installed. The check is
    // async, so start right after it — cloud engine on any doubt.
    void canProcessLocally(SpeechRecognition, lang).then((local) => {
      if (disposed) return;
      let useLocal = local;
      if (useLocal) {
        try { recognition.processLocally = true; } catch (_) { useLocal = false; }
      }
      setOnDevice(useLocal);
      start();
    });

    // Only mark THIS session dead. Don't touch enabledRef here: on a language
    // change the cleanup runs after the render that synced it, so clearing it
    // left the new session unable to restart after Chrome's first auto-stop.
    return () => {
      disposed = true;
      if (listeningOffTimer.current) clearTimeout(listeningOffTimer.current);
      recognition.stop();
    };
  }, [enabled, language]); // ← only restarts on enable/language change

  return { isListening, audioLevel, lastTranscript, onDevice };
}
