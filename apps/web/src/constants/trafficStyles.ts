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
