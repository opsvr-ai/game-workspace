// craftsman-ignore: TS001,TS002
import React from 'react';
import { Alert, Space, Typography } from 'antd';

const { Text } = Typography;

/**
 * 「陪玩对标笔记采集器」的下载 + 装法（老板 2026-10-02：「那个插件我去哪里找到」）。
 *
 * 「拆解分析 / 文案生成」要的对标笔记 JSON，就是这个浏览器插件在**小红书笔记页**采集出来的：
 * 点页面右下角「采集此笔记」→ 点插件图标 → 「复制 JSON」，粘进页面里的输入框。
 * 插件不在应用商店里（我们自己的采集工具，只做手动采集、不自动登录、不自动发布），
 * 所以下载到的是压缩包，装法是 Chromium 系的「加载已解压的扩展程序」。
 *
 * 2026-10-02 补：老板用的是 **360 极速浏览器**，原来那行只写「Chrome 地址栏敲 chrome://extensions」，
 * 他自然对不上号。现在按 `navigator.userAgent` **认一下用户实际在用什么浏览器**，
 * 直接告诉他那个浏览器该敲什么：
 *   - Chrome            → chrome://extensions
 *   - Edge              → edge://extensions
 *   - 360 极速浏览器    → chrome://extensions（自家「扩展管理」入口在右上角菜单里）
 *   - 360 安全浏览器    → se://extensions
 *   - 其它国产 Chromium → chrome://extensions
 *   - 火狐              → 装不了，提示换浏览器
 * 认不出来 / 上面那串打不开时，兜底写「点浏览器右上角菜单 →「扩展 / 扩展管理」」——
 * 国产内核浏览器把内建页藏起来时，这是唯一一定找得到的入口。
 *
 * 2026-10-03 再补（在邵泽慧那台 `192.168.1.4` 上实测，老板：「解压过，但选完文件夹什么都没有」）：
 * 她用的 **360 极速浏览器 X** 内核是 **Chromium 132**（够新，支持我们这个 MV3 插件），
 * 解压也没错（4 个文件、manifest.json 就在根上），可「加载已解压的扩展程序」选完文件夹
 * **既装不上也不报错**；翻她那个浏览器的插件清单，10 条全是商店/内置插件（开发者模式确实开着），
 * 从来没有任何一条「自装插件」登记成功。同一份插件本地在 Chromium 里装是好的 ——
 * 也就是说 **360 系浏览器会把这种自装插件静默吃掉**。
 * 所以 360 极速 / 360 安全 / 火狐这几种，页面顶部**直接给一句「换 Chrome 装」**，
 * 别让人对着它反复试（老板最烦「反反复复」）。
 * 顺带把「选哪一层文件夹」也写清楚（选中里面**直接有 manifest.json** 的那层，别再点进子文件夹）——
 * 这是「选完没反应」除了浏览器拦插件之外最常见的原因。
 *
 * 这个插件被两处用到 ——「工作室账号管理 → 账号计划表 → 对标笔记导入」和
 * 「内容查重风控 → 对标笔记导入」—— 所以下载地址和装法只写在这一份里，别两页各写一套慢慢走样。
 */
export const COLLECTOR_PLUGIN_ZIP = '/uploads/xhs-note-collector.zip';

/** 解压 + 装插件那几步（各浏览器只有「地址栏敲什么」这一句不同）。 */
const STEPS =
  '下载后先解压（右键压缩包 →「全部解压缩」）→ 打开页面右上角的「开发者模式」→ 点「加载已解压的扩展程序」，' +
  '选中解压出来、里面直接就有 manifest.json 的那个文件夹（别再点进子文件夹）→ 装好后打开一篇小红书笔记，' +
  '点页面右下角的「采集此笔记」，再点浏览器右上角的插件图标、点「复制 JSON」，把复制到的内容粘到下面这个框里。';

/** 装不上时的兜底：换 Chrome（本机一般都装了 Chrome；360 系浏览器上那一步卡住时，这是最省事的路）。 */
export const CHROME_FALLBACK =
  '换 Chrome 装：Chrome 地址栏敲 chrome://extensions 回车 → 打开右上角「开发者模式」→ 点「加载已解压的扩展程序」，' +
  '选中刚才解压出来、里面直接能看到 manifest.json 的那个文件夹。本机一般装有 Chrome（开始菜单搜 “Chrome”，' +
  '或双击桌面 / 开始菜单里的 Google Chrome）。';

export interface BrowserHint {
  /** 浏览器名（写给别人看的） */
  name: string;
  /** 地址栏里敲这个进「扩展管理」；null = 这个浏览器装不了 */
  extUrl: string | null;
  /** 补充一句（打不开时怎么用菜单找，或为什么装不了） */
  extra?: string;
  /** 这个浏览器会把自装插件静默拦掉 —— 有值时页面顶部直接提示「换 Chrome」 */
  blocker?: string;
}

const MENU_HINT = '打不开就点浏览器右上角菜单 →「扩展 / 扩展管理」';

const BLOCKED_BY_360 =
  '在 360 系浏览器上这一步容易「点了没反应」：要点的按钮叫「加载已解压的扩展程序」（旁边还有一个「打包扩展程序」，' +
  '点错它什么也不会发生），选文件夹要选到里面直接能看到 manifest.json 的那一层。' +
  '2026-10-03 在邵泽慧那台就遇到过“选完文件夹什么都没有”。' +
  '如果按下面步骤试了还是没反应，别反复试：' + CHROME_FALLBACK;

const BLOCKED_BY_FIREFOX =
  '火狐装不了这个插件（它是 Chrome 内核的），别在这儿反复试。' + CHROME_FALLBACK;

/** 按用户实际在用的浏览器，给出对得上的「扩展管理」入口。 */
export function detectBrowserHint(): BrowserHint {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  if (/Edg\//.test(ua)) return { name: 'Edge', extUrl: 'edge://extensions', extra: MENU_HINT };
  // 360 系要先判「安全浏览器」，它的 UA 里同时带 QIHU
  if (/360SE|QIHU 360SE/i.test(ua)) {
    return { name: '360 安全浏览器', extUrl: 'se://extensions', extra: MENU_HINT, blocker: BLOCKED_BY_360 };
  }
  if (/360EE|360Chrome|QIHU/i.test(ua)) {
    return { name: '360 极速浏览器', extUrl: 'chrome://extensions', extra: MENU_HINT, blocker: BLOCKED_BY_360 };
  }
  if (/QQBrowser/i.test(ua)) {
    return { name: 'QQ 浏览器', extUrl: 'chrome://extensions', extra: MENU_HINT };
  }
  if (/MetaSr|Sogou/i.test(ua)) return { name: '搜狗高速浏览器', extUrl: 'chrome://extensions', extra: MENU_HINT };
  if (/2345Explorer/i.test(ua)) return { name: '2345 浏览器', extUrl: 'chrome://extensions', extra: MENU_HINT };
  if (/LieBaoFast|LBBROWSER/i.test(ua)) return { name: '猎豹浏览器', extUrl: 'chrome://extensions', extra: MENU_HINT };
  if (/Maxthon/i.test(ua)) return { name: '傲游浏览器', extUrl: 'chrome://extensions', extra: MENU_HINT };
  if (/Firefox\//.test(ua)) return { name: 'Firefox', extUrl: null, extra: '火狐装不了 Chrome 内核的插件', blocker: BLOCKED_BY_FIREFOX };
  if (/Chrome\//.test(ua)) return { name: 'Chrome', extUrl: 'chrome://extensions', extra: MENU_HINT };
  return { name: '你的浏览器', extUrl: 'chrome://extensions', extra: MENU_HINT };
}

const CollectorPluginHint: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const browser = detectBrowserHint();
  return (
    <Space direction="vertical" size={4} style={{ marginBottom: 8 }}>
      {browser.blocker && (
        <Alert
          type="warning"
          showIcon
          style={{ padding: '6px 10px', maxWidth: 720 }}
          message={<span style={{ fontSize: 12 }}>{browser.blocker}</span>}
        />
      )}
      <a href={COLLECTOR_PLUGIN_ZIP} download style={{ fontWeight: 600 }}>
        ⬇️ 下载采集插件（陪玩对标笔记采集器）
      </a>
      {browser.extUrl && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          装法：在 {browser.name} 地址栏输入 <Text code>{browser.extUrl}</Text> 回车（{browser.extra}）→ {STEPS}
        </Text>
      )}
      {!compact && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          要采长尾词：在小红书搜索框里输入关键词、等候选词弹出来，点右下角「采集下拉词」，
          插件里点「复制长尾词」，再粘到「手动长尾词库」里。
          插件只在这台电脑的浏览器本地跑，采集的数据也只存在浏览器里，不自动登录、不自动发布。
        </Text>
      )}
    </Space>
  );
};

export default CollectorPluginHint;
