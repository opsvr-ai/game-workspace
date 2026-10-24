/**
 * 账号只有 3 个大类；甜妹/御姐/少御/少萝/cso 这些都是大类下的细分风格。
 * 页面和总览共用这一份，避免两边各写一套慢慢走样。
 */
export const TRAFFIC_ACCOUNT_ROLES = ['情绪娱乐号', '技术上分号', '避坑干货号'] as const;

export const TRAFFIC_STYLE_PRESETS: Record<string, string[]> = {
  情绪娱乐号: ['甜妹', '御姐', '少萝', 'COS', '真实照'],
  技术上分号: ['甜妹', '御姐', '少萝', 'COS', '真实照'],
  避坑干货号: ['避坑', '干货', '测评', '攻略', '科普'],
};

export const ALL_TRAFFIC_STYLES = Array.from(new Set(Object.values(TRAFFIC_STYLE_PRESETS).flat()));

/** 历史上很多人只填了细分风格、大类空着；按风格反推大类，避免总览出现一大片「未分类」。 */
export function inferTrafficRole(role?: string | null, style?: string | null): string {
  const r = String(role || '').trim();
  if ((TRAFFIC_ACCOUNT_ROLES as readonly string[]).includes(r)) return r;
  const s = String(style || '').trim();
  if (/避坑|干货|测评|攻略|科普/.test(s)) return '避坑干货号';
  if (/技术|上分|大神|CSO|硬核|教学|陪练/i.test(s)) return '技术上分号';
  if (/甜妹|御姐|少萝|COS|真实照|纯欲|性感|清纯|清新|在校|女大|邻家|高冷|搞笑/i.test(s)) return '情绪娱乐号';
  return '未分类';
}

/** 细分风格没填时不要拿大类硬当风格，否则会出现「情绪娱乐号 → 情绪娱乐号」这种重复卡片。 */
/** 老数据里常见的叫法，统一归到官方细分风格；清单外的自定义词一律归「未细分」。 */
const STYLE_ALIASES: Record<string, string> = {
  少萝性感: '少萝',
  纯欲甜妹: '甜妹',
  纯欲性感: '御姐',
  性感: '御姐',
  清纯女大: '真实照',
  在校女大: '真实照',
  清新自然: '真实照',
  cosplay: 'COS',
};

export function normalizeTrafficStyle(style?: string | null): string {
  const s = String(style || '').trim();
  if (!s) return '未细分';
  // 老数据里有人把大类写进了风格字段（例如风格=情绪娱乐号），不要显示成「大类 → 同名大类」。
  if ((TRAFFIC_ACCOUNT_ROLES as readonly string[]).includes(s)) return '未细分';
  if (STYLE_ALIASES[s]) return STYLE_ALIASES[s];
  return ALL_TRAFFIC_STYLES.includes(s) ? s : '未细分';
}
