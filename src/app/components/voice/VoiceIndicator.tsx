import { useState, useEffect, useRef } from 'react';
import styles from './voiceIndicator.module.css';

export function VoiceIndicator() {
  const [level, setLevel] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const initMicrophone = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });
        micStreamRef.current = stream;

        const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;

        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.85;
        source.connect(analyser);
        analyserRef.current = analyser;

        setIsActive(true);
        updateLevel();
      } catch (error) {
        console.error('Microphone access denied:', error);
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
    return (
      <div className={`${styles.voiceIndicator} ${styles.error}`}>
        <div className={styles.indicatorDot} />
        <span>Microphone not accessible</span>
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
