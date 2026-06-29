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
  const {
    language,
    validBibs,
    commands,
    onBibDetected,
    onCommand,
    enabled,
  } = options;

  const recognitionRef = useRef<any>(null);
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [lastTranscript, setLastTranscript] = useState('');

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

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language === 'en' ? 'en-US' : 'he-IL';

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
    };

    recognition.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      const fullTranscript = finalTranscript || interimTranscript;
      setLastTranscript(fullTranscript);

      if (finalTranscript) {
        const lowerTranscript = finalTranscript.toLowerCase().trim();

        // Check for commands first
        for (const cmd of commands) {
          if (cmd.trigger.some(t => lowerTranscript.includes(t.toLowerCase()))) {
            onCommand(cmd.action);
            return;
          }
        }

        // Extract numbers
        const numbers = extractNumbers(finalTranscript, language);
        if (numbers.length > 0) {
          const bibNumber = String(numbers[0]);
          if (validBibs.has(bibNumber)) {
            onBibDetected(bibNumber);
          }
        }
      }
    };

    recognition.start();

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [enabled, language, validBibs, commands, onBibDetected, onCommand]);

  return {
    isListening,
    audioLevel,
    lastTranscript,
  };
}
