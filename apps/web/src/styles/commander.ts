// ── 指挥官风设计令牌（源自客户追踪中心）──
// 全项目统一用的配色 / 渐变 / 玻璃拟态，避免各页面各写一套。

export const commander = {
  // 霓虹主色
  cyan: '#00E5FF',
  purple: '#7C4DFF',
  pink: '#FF2E9A',
  gold: '#FFB300',
  green: '#00E676',
  red: '#FF4D6D',

  // 深色背景
  bgDeep: '#070B18',
  bgMid: '#0B1024',
  bgEnd: '#130B2E',

  // 文本
  textPrimary: '#EAF2FF',
  textSecondary: '#A9B7D9',
  textMuted: '#8A97B8',

  // 玻璃拟态
  glass: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    backdropFilter: 'blur(14px)',
    borderRadius: 18,
    boxShadow: '0 10px 40px rgba(0,0,0,0.35)',
  } as const,

  // 渐变文字
  gradientText: {
    background: 'linear-gradient(90deg,#00E5FF 0%,#7C4DFF 50%,#FF2E9A 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  } as const,

  // 全局深色渐变背景
  background: 'radial-gradient(1200px 500px at 10% 0%, rgba(124,77,255,0.28), transparent 55%), radial-gradient(1000px 500px at 100% 0%, rgba(0,229,255,0.20), transparent 55%), linear-gradient(160deg,#070B18 0%,#0B1024 45%,#130B2E 100%)',
} as const;
