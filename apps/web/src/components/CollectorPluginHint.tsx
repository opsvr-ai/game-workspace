// craftsman-ignore: TS001,TS002
import React from 'react';
import { Space, Typography } from 'antd';

const { Text } = Typography;

/**
 * 「陪玩对标笔记采集器」的下载 + 装法（老板 2026-10-02：「那个插件我去哪里找到」）。
 *
 * 「拆解分析 / 文案生成」要的对标笔记 JSON，就是这个浏览器插件在**小红书笔记页**采集出来的：
 * 点页面右下角「采集此笔记」→ 点插件图标 → 「复制 JSON」，粘进页面里的输入框。
 * 插件不在 Chrome 应用商店里（我们自己的采集工具，只做手动采集、不自动登录、不自动发布），
 * 所以下载到的是压缩包，装法是 Chrome 的「加载已解压的扩展程序」。
 *
 * 这个插件被两处用到 ——「工作室账号管理 → 账号计划表 → 对标笔记导入」和
 * 「内容查重风控 → 对标笔记导入」—— 所以下载地址和装法只写在这一份里，别两页各写一套慢慢走样。
 */
export const COLLECTOR_PLUGIN_ZIP = '/uploads/xhs-note-collector.zip';

const CollectorPluginHint: React.FC<{ compact?: boolean }> = ({ compact }) => (
  <Space direction="vertical" size={2} style={{ marginBottom: 8 }}>
    <a href={COLLECTOR_PLUGIN_ZIP} download style={{ fontWeight: 600 }}>
      ⬇️ 下载采集插件（陪玩对标笔记采集器）
    </a>
    <Text type="secondary" style={{ fontSize: 12 }}>
      装法：下载后先解压 → 在 Chrome 地址栏输入 chrome://extensions 回车 → 右上角打开「开发者模式」→
      点「加载已解压的扩展程序」，选中刚解压出来的那个文件夹。装好后打开一篇小红书笔记，
      点页面右下角的「采集此笔记」；再点浏览器右上角的插件图标、点「复制 JSON」，
      把复制到的内容粘到下面这个框里。
    </Text>
    {!compact && (
      <Text type="secondary" style={{ fontSize: 12 }}>
        要采长尾词：在小红书搜索框里输入关键词、等候选词弹出来，点右下角「采集下拉词」，
        插件里点「复制长尾词」，再粘到「手动长尾词库」里。
        插件只在这台电脑的浏览器本地跑，采集的数据也只存在浏览器里，不自动登录、不自动发布。
      </Text>
    )}
  </Space>
);

export default CollectorPluginHint;
