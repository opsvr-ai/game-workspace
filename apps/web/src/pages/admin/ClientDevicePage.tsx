// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import MachinesPage from './MachinesPage';
import PcControlPage from './PcControlPage';
import AgentVersionPage from './AgentVersionPage';

/**
 * 「客户端与设备」—— 老板 2026-10-07：「远程控制 / 机器管理 / 客户端版本 这 3 个功能合并」。
 *
 * 这三页本来就是一件事的三个面：本店有哪些电脑（机器管理）→ 远程看它 / 给它下指令（远程控制）
 * → 它上面的客户端是不是最新（客户端版本）。以前在左侧菜单里各占一行，找东西要在三页之间来回跳。
 * 现在收成一页、三个页签，谁也不用再记「这个功能在哪一页」。
 *
 * 规矩：
 *  - 只挂载当前页签：没点开的页签不请求数据（三页各自的接口都不轻）；
 *  - 页签写进地址栏 ?tab=：刷新、老书签、别人发过来的链接都落在同一个页签上；
 *  - 老地址 /admin/pc-control、/admin/agent-version 在 router.tsx 里重定向过来（?tab=remote / ?tab=version）。
 */
type TabKey = 'machines' | 'remote' | 'version';

const TAB_KEYS: TabKey[] = ['machines', 'remote', 'version'];

const TAB_LABELS: Record<TabKey, string> = {
  machines: '机器管理',
  remote: '远程控制',
  version: '客户端版本',
};

const asTabKey = (v: string | null): TabKey =>
  v === 'remote' || v === 'version' ? v : 'machines';

const ClientDevicePage: React.FC = () => {
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
        title="客户端与设备"
        subtitle="本店电脑台账、远程控制、客户端版本 —— 都在这三个页签里"
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
    </div>
  );
};

export default ClientDevicePage;
