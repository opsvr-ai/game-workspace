import http from './client';
import { message } from 'antd';

/**
 * 系统配置接口。
 *
 * 老板 2026-09-21：以后进来的租赁线下工作室 / 线上俱乐部，数据由他们自己的店长填。
 * 同一个接口，写到哪里看身份：
 * - 老板保存 → 全局默认，所有店都跟着变；
 * - 店长保存 → 只写本店覆盖，只影响自己店（全站唯一的键会被后端跳过）。
 */
export const configApi = {
  getAll: () => http.get('/config'),
  /** 读配置。第 2 个参数 studioId 只有老板用得上（查某家店的生效值），店长自动读本店。 */
  get: (keys?: string[], studioId?: string) =>
    http.get('/config', {
      params: {
        ...(keys && keys.length ? { keys: keys.join(',') } : {}),
        ...(studioId ? { studioId } : {}),
      },
    }),

  /**
   * 保存配置。店长保存时如果混了全站唯一的键，后端不会报错拒绝整次保存，
   * 而是把跳过的键列在 `data.skipped` 里 —— 这里统一弹一个提示，
   * 免得 13 个设置页各写一遍（也不会出现「改了没生效又不知道为啥」）。
   */
  update: async (data: Record<string, any>) => {
    const res = await http.put('/config', data);
    const skipped = res?.data?.data?.skipped;
    if (Array.isArray(skipped) && skipped.length) {
      message.warning(
        `本店设置已保存；以下这些是全站只有一份的配置，只有老板能改，本次没有改动：${skipped.join('、')}`,
        8,
      );
    }
    return res;
  },

  /** 「恢复用老板的默认」：删掉本店自己填的覆盖。不传 keys = 本店全部恢复。 */
  resetStudioOverrides: (keys?: string[], studioId?: string) =>
    http.delete('/config/studio-overrides', {
      params: {
        ...(keys && keys.length ? { keys: keys.join(',') } : {}),
        ...(studioId ? { studioId } : {}),
      },
    }),
};
