/**
 * 到点语音提醒：用系统自带 Web Speech 发音，按预设做音高 / 语速变化。
 *
 * 不依赖客户端发版（Electron 壳里跑的就是本网页）；先给老板试听，确认后再考虑
 * 换成真正的云端声线模型。所有设置存本机，每台电脑各选各的。
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
];

const PRESET_KEY = 'chunlv:voice-reminder-preset';
const VOLUME_KEY = 'chunlv:voice-reminder-volume';
const DEFAULT_PRESET = 'female_tianmei';
const DEFAULT_VOLUME = 70;

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
}

/**
 * 播报一条提醒。返回是否真的交给了系统 TTS（false = 当前电脑没有可用语音）。
 * 失败不抛错：不能让语音失败影响到点提醒的其他逻辑。
 */
export function speakVoiceReminder(text: string, presetId?: string, volume?: number): boolean {
  const content = String(text || '').trim();
  if (!content || typeof window === 'undefined' || !window.speechSynthesis) return false;
  try {
    stopVoiceReminder();
    const preset = getVoicePreset(presetId);
    const utter = new SpeechSynthesisUtterance(content);
    const voice = pickChineseVoice(preset.gender);
    if (voice) utter.voice = voice;
    utter.lang = voice?.lang || 'zh-CN';
    utter.pitch = preset.pitch;
    utter.rate = preset.rate;
    utter.volume = Math.min(1, Math.max(0, (volume ?? getVoiceVolume()) / 100));
    window.speechSynthesis.speak(utter);
    return true;
  } catch {
    return false;
  }
}
