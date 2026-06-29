import { useState, useEffect, useRef } from 'react';
import styles from './voiceIndicator.module.css';

export function VoiceIndicator() {
  const [level, setLevel] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string>('');
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const initMicrophone = async () => {
      try {
        console.log('VoiceIndicator: Requesting microphone access...');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });
        console.log('VoiceIndicator: Microphone access granted, stream:', stream);
        micStreamRef.current = stream;

        const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) {
          console.error('VoiceIndicator: AudioContext not supported');
          setIsActive(false);
          return;
        }
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;

        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.85;
        source.connect(analyser);
        analyserRef.current = analyser;

        console.log('VoiceIndicator: Audio analyser setup complete, starting level updates');
        setIsActive(true);
        updateLevel();
      } catch (err: any) {
        const errorMsg = err?.name || err?.message || String(err);
        console.error('VoiceIndicator: Microphone access error:', errorMsg, err);
        setError(errorMsg);
        setIsActive(false);
      }
    };

    initMicrophone();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const updateLevel = () => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);
    const normalized = Math.min(100, (rms / 25) * 100);

    setLevel(Math.round(normalized));
    animationRef.current = requestAnimationFrame(updateLevel);
  };

  if (!isActive) {
    const displayError = error || 'Microphone not accessible';
    return (
      <div className={`${styles.voiceIndicator} ${styles.error}`}>
        <div className={styles.indicatorDot} />
        <span title={displayError}>{displayError}</span>
      </div>
    );
  }

  const isDetectingVoice = level > 15;

  return (
    <div className={`${styles.voiceIndicator} ${isDetectingVoice ? styles.active : ''}`}>
      <div className={`${styles.indicatorDot} ${isDetectingVoice ? styles.listening : ''}`} />
      <span className={styles.indicatorText}>
        {isDetectingVoice ? '🎤 Voice detected!' : 'Ready to listen'}
      </span>
      <div className={styles.voiceMeter}>
        <div
          className={styles.voiceMeterFill}
          style={{ width: `${level}%` }}
        />
      </div>
    </div>
  );
}
