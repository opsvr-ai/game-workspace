// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import MachinesPage from './MachinesPage';
import PcControlPage from './PcControlPage';
import AgentVersionPage from './AgentVersionPage';
import BlacklistPage from './BlacklistPage';
import WhitelistPage from './WhitelistPage';
import ProcessKillLogPage from './ProcessKillLogPage';

/**
 * 「客户端管理」—— 老板 2026-10-07 一口气并出来的唯一一页：
 *   第一批：「远程控制 / 机器管理 / 客户端版本」合成「客户端与设备」；
 *   第二批：「进程黑名单 / 进程白名单 / 杀进程日志」合成「进程管控」；
 *   收尾：老板指着这两条说「进程管控 + 客户端与设备 合并到客户端管理」—— 左侧菜单只剩这一条，
 *         六个页签排在一起（机器管理 / 远程控制 / 客户端版本 / 进程黑名单 / 进程白名单 / 杀进程日志）。
 *
 * 为什么能这么并：这六件事本来就是一台电脑的一生 —— 它是谁、在不在线（机器管理）→ 远程看它 / 给它下指令
 * （远程控制）→ 它上面的客户端是不是最新（客户端版本）→ 哪些进程要关 / 哪些绝对不能关（黑 / 白名单）
 * → 真的关过谁、成没成（杀进程日志）。以前是左侧菜单六行、点来点去还得先记住该进哪一页。
 *
 * 规矩（和前两批同一套）：
 *  - 只挂载当前页签：没点开的页签不请求数据（六页各自的接口都不轻）；
 *  - 页签写进地址栏 ?tab=：刷新、老书签、别人发过来的链接都落在同一个页签上；
 *  - 老地址 /admin/machines、/admin/process-control、/admin/pc-control、/admin/agent-version、
 *    /admin/blacklist、/admin/whitelist、/admin/process-kill-log 在 router.tsx 里重定向过来
 *    （页签 key 前后没变，老链接的 ?tab= 原样带得过来）。
 */
type TabKey = 'machines' | 'remote' | 'version' | 'blacklist' | 'whitelist' | 'killlog';

const TAB_KEYS: TabKey[] = ['machines', 'remote', 'version', 'blacklist', 'whitelist', 'killlog'];

const TAB_LABELS: Record<TabKey, string> = {
  machines: '机器管理',
  remote: '远程控制',
  version: '客户端版本',
  blacklist: '进程黑名单',
  whitelist: '进程白名单',
  killlog: '杀进程日志',
};

const asTabKey = (v: string | null): TabKey =>
  (TAB_KEYS as string[]).includes(v || '') ? (v as TabKey) : 'machines';

const ClientManagementPage: React.FC = () => {
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
        title="客户端管理"
        subtitle="本店电脑台账、远程控制、客户端版本、进程名单与杀进程记录 —— 都在这六个页签里"
      />
      <Tabs
        activeKey={tab}
        animated={false}
        onChange={change}
        items={TAB_KEYS.map((key) => ({ key, label: TAB_LABELS[key] }))}
      />
      {tab === 'machines' && <MachinesPage embedded />}
      {tab === 'remote' && <PcControlPage embedded />}
      {tab === 'version' && <AgentVersionPage embedded />}
      {tab === 'blacklist' && <BlacklistPage embedded />}
      {tab === 'whitelist' && <WhitelistPage embedded />}
      {tab === 'killlog' && <ProcessKillLogPage embedded />}
    </div>
  );
};

export default ClientManagementPage;
