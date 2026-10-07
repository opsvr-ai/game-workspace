// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import BlacklistPage from './BlacklistPage';
import WhitelistPage from './WhitelistPage';
import ProcessKillLogPage from './ProcessKillLogPage';

/**
 * 「进程管控」—— 老板 2026-10-07：「进程黑名单 / 进程白名单 / 杀进程日志 这 3 个功能合并」。
 *
 * 这三页本来就是一件事的三个面：名单里哪些进程要关（黑名单）→ 哪些进程绝对不能关（白名单）
 * → 真的关过谁、成没成（杀进程日志）。以前在左侧菜单里各占一行，查完名单想对一遍日志还得换页。
 * 现在收成一页、三个页签，谁也不用再记「这个功能在哪一页」。
 *
 * 规矩（和「客户端与设备」同一套）：
 *  - 只挂载当前页签：没点开的页签不请求数据（三页各自的接口都不轻）；
 *  - 页签写进地址栏 ?tab=：刷新、老书签、别人发过来的链接都落在同一个页签上；
 *  - 老地址 /admin/blacklist、/admin/whitelist、/admin/process-kill-log 在 router.tsx 里重定向过来。
 */
type TabKey = 'blacklist' | 'whitelist' | 'killlog';

const TAB_KEYS: TabKey[] = ['blacklist', 'whitelist', 'killlog'];

const TAB_LABELS: Record<TabKey, string> = {
  blacklist: '进程黑名单',
  whitelist: '进程白名单',
  killlog: '杀进程日志',
};

const asTabKey = (v: string | null): TabKey =>
  v === 'whitelist' || v === 'killlog' ? v : 'blacklist';

const ProcessControlPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>(() => asTabKey(searchParams.get('tab')));

  // 老地址重定向过来时同步页签；在页签之间点来点去时值已经一样，不会互相打架。
  useEffect(() => {
    setTab(asTabKey(searchParams.get('tab')));
  }, [searchParams]);

  const change = (key: string) => {
    const next = asTabKey(key);
    setTab(next);
    setSearchParams({ tab: next }, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="进程管控"
        subtitle="黑名单、白名单、杀进程记录 —— 都在这三个页签里"
      />
      <Tabs
        activeKey={tab}
        animated={false}
        onChange={change}
        items={TAB_KEYS.map((key) => ({ key, label: TAB_LABELS[key] }))}
      />
      {tab === 'blacklist' && <BlacklistPage embedded />}
      {tab === 'whitelist' && <WhitelistPage embedded />}
      {tab === 'killlog' && <ProcessKillLogPage embedded />}
    </div>
  );
};

export default ProcessControlPage;
