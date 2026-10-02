// craftsman-ignore: TS001,TS002
import React from 'react';
import { Space, Typography } from 'antd';

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
 * 这个插件被两处用到 ——「工作室账号管理 → 账号计划表 → 对标笔记导入」和
 * 「内容查重风控 → 对标笔记导入」—— 所以下载地址和装法只写在这一份里，别两页各写一套慢慢走样。
 */
export const COLLECTOR_PLUGIN_ZIP = '/uploads/xhs-note-collector.zip';

export interface BrowserHint {
  /** 浏览器名（写给别人看的） */
  name: string;
  /** 地址栏里敲这个进「扩展管理」；null = 这个浏览器装不了 */
  extUrl: string | null;
  /** 补充一句（打不开时怎么用菜单找，或为什么装不了） */
  extra?: string;
}

/** 按用户实际在用的浏览器，给出对得上的「扩展管理」入口。 */
export function detectBrowserHint(): BrowserHint {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  const menu = '打不开就点浏览器右上角菜单 →「扩展 / 扩展管理」';
  if (/Edg\//.test(ua)) return { name: 'Edge', extUrl: 'edge://extensions', extra: menu };
  // 360 系要先判「安全浏览器」，它的 UA 里同时带 QIHU
  if (/360SE|QIHU 360SE/i.test(ua)) return { name: '360 安全浏览器', extUrl: 'se://extensions', extra: menu };
  if (/360EE|360Chrome|QIHU/i.test(ua)) return { name: '360 极速浏览器', extUrl: 'chrome://extensions', extra: menu };
  if (/QQBrowser/i.test(ua)) return { name: 'QQ 浏览器', extUrl: 'chrome://extensions', extra: menu };
  if (/MetaSr|Sogou/i.test(ua)) return { name: '搜狗高速浏览器', extUrl: 'chrome://extensions', extra: menu };
  if (/2345Explorer/i.test(ua)) return { name: '2345 浏览器', extUrl: 'chrome://extensions', extra: menu };
  if (/LieBaoFast|LBBROWSER/i.test(ua)) return { name: '猎豹浏览器', extUrl: 'chrome://extensions', extra: menu };
  if (/Maxthon/i.test(ua)) return { name: '傲游浏览器', extUrl: 'chrome://extensions', extra: menu };
  if (/Firefox\//.test(ua)) {
    return {
      name: 'Firefox',
      extUrl: null,
      extra: '这个插件是 Chrome 内核的，火狐装不了；请改用 Chrome / Edge / 360 极速浏览器打开本页再装',
    };
  }
  if (/Chrome\//.test(ua)) return { name: 'Chrome', extUrl: 'chrome://extensions', extra: menu };
  return { name: '你的浏览器', extUrl: 'chrome://extensions', extra: menu };
}

const CollectorPluginHint: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const browser = detectBrowserHint();
  return (
    <Space direction="vertical" size={2} style={{ marginBottom: 8 }}>
      <a href={COLLECTOR_PLUGIN_ZIP} download style={{ fontWeight: 600 }}>
        ⬇️ 下载采集插件（陪玩对标笔记采集器）
      </a>
      {browser.extUrl ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          装法：下载后先解压 → 在 {browser.name} 地址栏输入 <Text code>{browser.extUrl}</Text> 回车
          （{browser.extra}）→ 打开右上角「开发者模式」→ 点「加载已解压的扩展程序」，
          选中刚解压出来的那个文件夹。装好后打开一篇小红书笔记，点页面右下角的「采集此笔记」；
          再点浏览器右上角的插件图标、点「复制 JSON」，把复制到的内容粘到下面这个框里。
          <br />
          （Chrome 敲 chrome://extensions、Edge 敲 edge://extensions、360 极速浏览器敲 chrome://extensions，
          360 安全浏览器敲 se://extensions；换浏览器装就照这个换。）
        </Text>
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>
          装法：{browser.extra}。装好后打开一篇小红书笔记，点页面右下角的「采集此笔记」；
          再点浏览器右上角的插件图标、点「复制 JSON」，把复制到的内容粘到下面这个框里。
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
