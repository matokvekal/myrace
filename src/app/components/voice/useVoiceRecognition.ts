import { useEffect, useRef, useState } from 'react';
import { extractNumbers } from '@/utils/numberParser';
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

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.continuous     = true;
    recognition.interimResults = true;
    recognition.lang           = language === 'en' ? 'en-US' : 'he-IL';

    recognition.onstart = () => {
      if (listeningOffTimer.current) clearTimeout(listeningOffTimer.current);
      setIsListening(true);
    };

    recognition.onend = () => {
      // Debounce "not connected" — Chrome restarts within ~300ms, so only flip
      // the indicator if it stays stopped for over 1 second
      listeningOffTimer.current = setTimeout(() => setIsListening(false), 1000);

      if (!enabledRef.current) return;
      // Small delay before restarting so we don't hammer the browser
      setTimeout(() => {
        if (!enabledRef.current) return;
        try { recognition.start(); } catch (_) {}
      }, 300);
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
      }
    };

    recognition.onresult = (event: any) => {
      try {
        // Only look at the newest result
        const idx    = event.results.length - 1;
        const result = event.results[idx];
        if (!result?.[0]) return;

        const transcript = result[0].transcript || '';
        if (!transcript.trim()) return;

        if (result.isFinal) {
          setLastTranscript(transcript);
          const lowerTranscript = transcript.toLowerCase().trim();

          // Commands first
          for (const cmd of commandsRef.current) {
            if (cmd.trigger.some(t => lowerTranscript.includes(t.toLowerCase()))) {
              onCommandRef.current(cmd.action);
              return;
            }
          }

          // Numbers — process ALL detected bibs in the transcript
          const numbers = extractNumbers(transcript, languageRef.current);
          for (const num of numbers) {
            const bibNumber = String(num);
            if (validBibsRef.current.has(bibNumber)) {
              onBibDetectedRef.current(bibNumber);
            }
          }
        } else {
          setLastTranscript(transcript);
        }
      } catch (error) {
        console.error('Error processing speech result:', error);
      }
    };

    recognition.start();

    return () => {
      enabledRef.current = false;
      if (listeningOffTimer.current) clearTimeout(listeningOffTimer.current);
      recognition.stop();
    };
  }, [enabled, language]); // ← only restarts on enable/language change

  return { isListening, audioLevel, lastTranscript };
}
