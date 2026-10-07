// craftsman-ignore: TS002
/**
 * 全屏打游戏时，「新单横幅」到底弹不弹 —— 也就是「这台机器会不会被横幅顶出游戏」。
 *
 * 老板 2026-10-07 报「别人发布订单右下角弹窗，别人机器上鼠标不点没事，童祥瑞的电脑弹窗就会
 * 自动跳到桌面」，2026-10-08 又报一次（「出现弹窗就会退到软件抢单池，鼠标没移动到弹窗也没点
 * 击也会弹」）。根因不是程序版本（台账里 12 台跑在同一个 1.0.20261020 构建上，童祥瑞也在其中），
 * 而是**游戏画面模式**：这张横幅是**置顶窗** ——
 *   游戏设成「独占全屏」（真全屏、没吃到 Windows「全屏优化」）的机器上，置顶窗一出现
 *   Windows 就把游戏顶回桌面；设成「无边框窗口 / 窗口化全屏」的机器上，横幅只是浮在游戏上面，
 *   什么都不影响。
 *
 * 所以策略分三档（陪玩端「设置 → 通知」里选，存本机、每台机器各存各的）：
 *   auto（默认）：只在「确实会被顶出去」的机器上压住横幅 —— 要么 Windows 说前台是独占全屏
 *                 （SHQueryUserNotificationState 报 D3D 全屏），要么这台机器以前被横幅顶出去过
 *                 （弹完 2.5 秒复查一次，记在本机。这是给「Windows 认不出独占全屏」的游戏兜底）；
 *   hold        ：全屏打游戏时永远不弹（2026-10-07 那个开关的语义，原样保留）；
 *   show        ：照旧弹在游戏上面（明确接受「可能被顶回桌面」）。
 *
 * 三条硬规则（都是踩过坑总结的）：
 *   ① 探测不出来一律按「没在全屏」处理 —— 宁可照旧弹一下，也不能因为探测失败把新单提醒吞掉；
 *   ② 「压住」不等于「吞掉」：提示音、闪任务栏、铃铛里的提醒记录、抢单池照旧，退出全屏立刻补弹；
 *   ③ 学习结果只往「怕被顶」的方向记，记错了的代价是这台机器打游戏时看不到横幅 ——
 *      所以复查必须拿到前后两次探测结果才下结论，探不出来就不记（见 isFullscreenKicked）。
 *
 * 这个文件只放「判断」，不碰 Electron、不起 PowerShell、不读注册表，好单独测：
 * 判断错了的代价两头都很难受（把正在打游戏的陪玩顶出游戏 / 新单提醒被吞）。
 */

export type BannerFsMode = 'auto' | 'hold' | 'show';

/** 前台窗口探测结果（main.ts 起 PowerShell 拿到的，这里只描述形状）。 */
export interface ForegroundProbe {
  /** 最前面的窗口是不是铺满整块屏（＝多半在全屏打游戏）。 */
  full: boolean;
  /** 那个窗口的进程名（小写；用来判断复查时「还是不是同一个游戏」）。 */
  exe: string;
  /** Windows 说这是「独占全屏」（D3D 真全屏）：这种机器上置顶窗一定把游戏顶回桌面。 */
  exclusive: boolean;
}

/** 这一次横幅怎么处理：show = 现在就弹；hold = 先压住，退出全屏再补弹。 */
export type BannerRoute = 'show' | 'hold';

/**
 * 读出「全屏打游戏时弹不弹」这一档设置。
 *
 * 老机器的键是布尔（bannerMuteWhileFullscreen）：true 曾经＝全屏不弹 → 迁移成 hold；
 * false 曾经＝照旧弹在游戏上面 → 迁移成 show；从没设过 → auto（新默认，自己判断这台机器属于哪种）。
 */
export function resolveBannerMode(raw: unknown, legacyMute?: unknown): BannerFsMode {
  if (raw === 'auto' || raw === 'hold' || raw === 'show') return raw;
  if (legacyMute === true) return 'hold';
  if (legacyMute === false) return 'show';
  return 'auto';
}

/**
 * 这一次到底弹不弹。
 *
 * probe 为 null（PowerShell 起不来 / 超时 / 解析不了）一律按「没在全屏」处理：宁可照旧弹一下，
 * 也不能因为探测失败把新单吞掉。
 */
export function decideBannerRoute(opts: {
  mode: BannerFsMode;
  probe: ForegroundProbe | null;
  /** 本机以前被这个横幅顶出去过（存在本机，见 main.ts 的 watchFullscreenKick）。 */
  learnedKick?: boolean;
}): BannerRoute {
  const { mode, probe, learnedKick } = opts;
  if (mode === 'show') return 'show'; // 明确要求照弹：连探都不用探
  if (!probe?.full) return 'show'; // 没在打全屏游戏：照旧弹
  if (mode === 'hold') return 'hold'; // 手动要求：全屏时一律压住
  // auto：只有「确实会被顶出去」的机器才压住
  return probe.exclusive || !!learnedKick ? 'hold' : 'show';
}

/**
 * 弹完横幅再探一次：全屏游戏是不是被这张横幅顶出去了。
 *
 * 两次探测都得是「在打全屏游戏」才下结论；复查探不出来（null）就当没发生 ——
 * 宁可漏记一次（下次再学），也不能把没毛病的机器记成有毛病（那样它以后打游戏时再也看不到横幅）。
 */
export function isFullscreenKicked(
  before: ForegroundProbe | null,
  afterTick: ForegroundProbe | null,
): boolean {
  if (!before?.full) return false;
  if (!afterTick) return false;
  if (!afterTick.full) return true; // 不再铺满整屏 = 被顶回桌面 / 退回窗口了
  return !!before.exe && !!afterTick.exe && before.exe !== afterTick.exe;
}
