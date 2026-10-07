// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Radio, Typography } from 'antd';
import { message } from '../utils/feedback';

/**
 * 陪玩端设置：「全屏打游戏时弹不弹窗」这一档（老板 2026-10-08）。
 *
 * 为什么要单拎出来：老板报童祥瑞那台「订单弹窗一出现就把游戏顶回桌面 / 退到抢单池」。
 * 根因是横幅是**置顶窗**，而他那台游戏跑在**独占全屏**（详见 electron/banner-policy.ts）。
 * 那一头的判断逻辑在陪玩端主进程里，这一头只管「让陪玩自己能选」：
 *   自动（默认）——只在「确实会被顶出去」的机器上不弹（童祥瑞那台就靠它自己认出来）；
 *   全屏时都不弹——打游戏时一律只响提示音 + 闪任务栏，退出全屏再补弹；
 *   全屏时照弹——照旧浮在游戏上面（独占全屏的游戏可能被顶回桌面，自己要认这点）。
 *
 * 三件事容易踩坑，所以单独成文件 + 单独测：
 *   ① 老键（bannerMuteWhileFullscreen = true）要当「全屏时都不弹」，不能掉回默认的「自动」；
 *   ② 本机陪玩端还是老版本时，新键（bannerFullscreenMode）它**根本不认** —— 所以每次都要**同时**写
 *      老键（bannerMuteWhileFullscreen，true = 全屏时不弹）。老板 2026-10-08 拍板不推客户端升级
 *      （改用「游戏设成无边框全屏」规避），于是「全屏时都不弹 / 全屏时照弹」这两档必须**现在就能
 *      在老板现有的客户端上生效**，不能点了没反应还回一句「已保存」；
 *   ③ 存在本机（electron-store），每台机器各存各的 —— 网页里打开时没有 electronAPI，整块跳过。
 */
export type BannerFsMode = 'auto' | 'hold' | 'show';

const MODE_TEXT: Record<BannerFsMode, string> = {
  auto: '自动（推荐）',
  hold: '全屏时都不弹',
  show: '全屏时照弹',
};

const SAVED_TEXT: Record<BannerFsMode, string> = {
  auto: '已设为自动：只在「会被弹窗顶出游戏」的机器上不弹',
  hold: '已设为不弹：全屏打游戏时只响提示音 + 闪任务栏，退出全屏后补弹',
  show: '已设为照弹：横幅会弹在游戏上面（独占全屏的游戏可能被顶回桌面）',
};

export default function BannerFullscreenModeSetting() {
  const [mode, setMode] = useState<BannerFsMode>('auto');
  // 本机陪玩端带不带新版策略；null = 读不到这个概念（网页里打开的），不提示任何话
  const [policyReady, setPolicyReady] = useState<boolean | null>(null);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.storeGet) return;
    Promise.all([
      api.storeGet('bannerFullscreenMode'),
      api.storeGet('bannerMuteWhileFullscreen'), // 老键：只用来把老机器的设置搬过来
      api.storeGet('bannerPolicyVersion'), // 本机陪玩端带不带新版策略
    ])
      .then(([rawMode, legacyMute, policy]: unknown[]) => {
        if (rawMode === 'auto' || rawMode === 'hold' || rawMode === 'show') setMode(rawMode);
        else if (legacyMute === true) setMode('hold');
        else if (legacyMute === false) setMode('show');
        setPolicyReady(policy === 1);
      })
      .catch(() => {
        /* 读不到就按默认「自动」显示，不打扰 */
      });
  }, []);

  const change = async (next: BannerFsMode) => {
    const previous = mode;
    setMode(next);
    try {
      const api = (window as any).electronAPI;
      if (api?.storeSet) {
        // 新键 = 新版陪玩端（三档）；老键 = 老板现在这些客户端（只有「全屏时不弹」一个开关）。
        // 两个都写：新版认新键（老键只是顺带留个底），老版认老键 —— 谁都能立刻生效。
        const results = await Promise.all([
          api.storeSet('bannerFullscreenMode', next),
          api.storeSet('bannerMuteWhileFullscreen', next === 'hold'),
        ]);
        // 太老的客户端（比如还没有这个功能的 1.0.20261020）两个键都不认，回 success:false ——
        // 那种情况不能骗人说存好了，得直接告诉他改游戏画面设置。
        const stored = results.some((r) => (r as { success?: boolean } | undefined)?.success !== false);
        if (!stored) {
          setMode(previous);
          message.warning('本机陪玩端版本太老，还改不了这个设置 —— 把游戏画面改成「无边框全屏」就不会被顶出去了');
          return;
        }
      }
      if (policyReady === false && next === 'auto') {
        // 老客户端没有「自动」这一档的概念，只当成了「照弹」—— 先说清楚，别让人以为已经防住了。
        message.warning('已保存，但「自动」要装上最新版客户端才有 —— 本机现在等同「照弹」；想不被顶出去请选「全屏时都不弹」');
      } else {
        message.success(SAVED_TEXT[next]);
      }
    } catch {
      setMode(previous);
      message.error('保存失败，请重试');
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 12 }}>
        <Typography.Text strong>全屏打游戏时弹不弹窗</Typography.Text>
        <Radio.Group
          value={mode}
          optionType="button"
          size="small"
          onChange={(e) => void change(e.target.value as BannerFsMode)}
        >
          {(Object.keys(MODE_TEXT) as BannerFsMode[]).map((k) => (
            <Radio.Button key={k} value={k}>
              {MODE_TEXT[k]}
            </Radio.Button>
          ))}
        </Radio.Group>
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 14 }}>
        默认「自动」：检测到前台是独占全屏的游戏（这种机器被置顶窗一盖就会掉回桌面）就先不弹，
        改成响提示音 + 闪任务栏，退出全屏立刻补弹；「无边框窗口 / 窗口化全屏」的机器照旧弹在游戏上面。
        「铃铛里的提醒 + 抢单池」任何情况都照旧，一单不会漏。
        {policyReady === false
          ? ' 本机陪玩端还是老版本：「全屏时都不弹 / 全屏时照弹」两档现在就生效；'
            + '「自动」要装上最新版客户端才有（本机现在等同「照弹」）。'
          : ''}
      </Typography.Text>
    </>
  );
}
