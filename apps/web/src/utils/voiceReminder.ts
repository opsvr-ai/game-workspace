import http from '../api/client';

/**
 * 到点语音提醒：默认文案播 Edge 神经语音 MP3；自定义文案由服务端实时生成。
 */
export type VoiceGender = 'male' | 'female';

export interface VoicePreset {
  id: string;
  label: string;
  gender: VoiceGender;
  pitch: number;
  rate: number;
  desc: string;
}

export const VOICE_PRESETS: VoicePreset[] = [
  { id: 'male_qingjiao', label: '男生 · 青椒音', gender: 'male', pitch: 1.25, rate: 1.08, desc: '年轻、偏亮' },
  { id: 'male_dashu', label: '男生 · 大叔音', gender: 'male', pitch: 0.72, rate: 0.9, desc: '低沉、慢' },
  { id: 'male_wenrun', label: '男生 · 温润音', gender: 'male', pitch: 0.92, rate: 0.98, desc: '正常男声' },
  { id: 'female_shaoluo', label: '女声 · 少萝音', gender: 'female', pitch: 1.55, rate: 1.1, desc: '高、轻快' },
  { id: 'female_yujie', label: '女声 · 御姐音', gender: 'female', pitch: 0.82, rate: 0.94, desc: '低、稳' },
  { id: 'female_tianmei', label: '女声 · 甜妹音', gender: 'female', pitch: 1.3, rate: 1.02, desc: '偏甜' },
  { id: 'female_dialect', label: '女声 · 东北小北', gender: 'female', pitch: 1.0, rate: 1.0, desc: '方言' },
];

const PRESET_KEY = 'chunlv:voice-reminder-preset';
const VOLUME_KEY = 'chunlv:voice-reminder-volume';
const DEFAULT_PRESET = 'female_tianmei';
const DEFAULT_VOLUME = 70;
const DEFAULT_REMINDER_TEXT = '服务时间到了，请结束服务';

let naturalAudio: HTMLAudioElement | null = null;

export function getVoicePresetId(): string {
  try {
    return localStorage.getItem(PRESET_KEY) || DEFAULT_PRESET;
  } catch {
    return DEFAULT_PRESET;
  }
}

export function setVoicePresetId(id: string): void {
  try { localStorage.setItem(PRESET_KEY, id); } catch { /* ignore */ }
}

export function getVoiceVolume(): number {
  try {
    const n = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function setVoiceVolume(v: number): void {
  try { localStorage.setItem(VOLUME_KEY, String(Math.min(100, Math.max(0, v)))); } catch { /* ignore */ }
}

export function getVoicePreset(id?: string): VoicePreset {
  return VOICE_PRESETS.find((p) => p.id === (id || getVoicePresetId())) || VOICE_PRESETS[0];
}

function pickChineseVoice(gender: VoiceGender): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    const zh = voices.filter((v) => /zh|chinese|中文|普通话/i.test(`${v.lang} ${v.name}`));
    if (!zh.length) return null;
    const male = /kangkang|yunxi|yunjian|男|male/i;
    const female = /huihui|xiaoxiao|xiaoyi|yaoyao|女|female/i;
    return zh.find((v) => (gender === 'male' ? male : female).test(v.name)) || zh[0];
  } catch {
    return null;
  }
}

export function stopVoiceReminder(): void {
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  try {
    if (naturalAudio) {
      naturalAudio.pause();
      naturalAudio.currentTime = 0;
    }
  } catch { /* ignore */ }
}

/**
 * 播报一条提醒。
 * 默认提醒文案用已生成的 Edge 神经语音 MP3（自然、无网络依赖）；
 * 店长自定义文案没有对应音频时，才退回系统语音合成。
 */
export function speakVoiceReminder(text: string, presetId?: string, volume?: number): boolean {
  const content = String(text || '').trim();
  if (!content || typeof window === 'undefined') return false;
  const preset = getVoicePreset(presetId);
  const vol = Math.min(1, Math.max(0, (volume ?? getVoiceVolume()) / 100));
  if (content === DEFAULT_REMINDER_TEXT) {
    try {
      stopVoiceReminder();
      naturalAudio = new Audio(`/voice-reminder/${preset.id}.mp3`);
      naturalAudio.volume = vol;
      void naturalAudio.play().catch(() => {
        // 音频加载失败时退回系统语音，不能让到点提醒完全没声
        speakWithBrowserVoice(content, preset, vol);
      });
      return true;
    } catch {
      return speakWithBrowserVoice(content, preset, vol);
    }
  }
  // 店长自定义文案：让服务端用 Edge TTS 现场生成自然语音，避免退回机器味系统音。
  void http.get('/companions/me/voice-reminder', {
    params: { text: content, preset: preset.id },
    responseType: 'blob',
  }).then(({ data }: any) => {
    try {
      stopVoiceReminder();
      const url = URL.createObjectURL(data);
      const audio = new Audio(url);
      audio.volume = vol;
      naturalAudio = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      void audio.play().catch(() => speakWithBrowserVoice(content, preset, vol));
    } catch {
      speakWithBrowserVoice(content, preset, vol);
    }
  }).catch(() => speakWithBrowserVoice(content, preset, vol));
  return true;
}

function speakWithBrowserVoice(content: string, preset: VoicePreset, volume: number): boolean {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;
  try {
    stopVoiceReminder();
    const utter = new SpeechSynthesisUtterance(content);
    const voice = pickChineseVoice(preset.gender);
    if (voice) utter.voice = voice;
    utter.lang = voice?.lang || 'zh-CN';
    utter.pitch = preset.pitch;
    utter.rate = preset.rate;
    utter.volume = volume;
    window.speechSynthesis.speak(utter);
    return true;
  } catch {
    return false;
  }
}
