export type Language = 'en' | 'he';
export type VoiceModel = 'webspeech';

export interface VoiceSettings {
  enabled: boolean;
  language: Language;
  model: VoiceModel;
  autoConfirm: boolean;
}

export interface VoiceCommand {
  trigger: string[];
  action: string;
}

export interface TranscriptResult {
  transcript: string;
  numbers: number[];
  confidence: number;
  processingTime: number;
  engine: 'webspeech';
}
