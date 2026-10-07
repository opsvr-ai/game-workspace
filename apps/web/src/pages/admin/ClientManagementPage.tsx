// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Segmented, Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import DevicesPanel from './DevicesPanel';
import BlacklistPage from './BlacklistPage';
import WhitelistPage from './WhitelistPage';
import ProcessKillLogPage from './ProcessKillLogPage';

/**
 * 「客户端管理」—— 左侧菜单只剩这一条，里面分两级页签。
 *
 * 老板 2026-10-07 连着收了三刀：
 *   ① 「远程控制 / 机器管理 / 客户端版本」并成「客户端与设备」；
 *   ② 「进程黑名单 / 进程白名单 / 杀进程日志」并成「进程管控」；
 *   ③ 指着这两条说「进程管控 + 客户端与设备 合并到客户端管理」—— 进来一看还是六个页签排一排，
 *      于是又说「机器管理、远程控制、客户端版本不都基本类似的？不能整合在一个页面么」。
 * 所以这一版把 ① 那三个**真的合成一张表**（见 DevicesPanel.tsx：一行一台电脑，操作也并到一行里），
 * 一级页签只留两个：电脑 / 进程名单。
 *
 * 为什么黑 / 白名单和杀进程日志还留在第二个页签里：它们跟「这台电脑是谁的」是两回事 ——
 * 一份进程名单管的是所有电脑，跟某一台不是一对一，塞进那张表反而讲不清。
 *
 * 地址栏（老书签一律不失效）：
 *   ?view=devices|process（默认 devices）；进程名单里的二级页签写 ?tab=blacklist|whitelist|killlog。
 *   老链接 ?tab=machines|remote|version（以前那三个页签）落到「电脑」这一级。
 */
type ViewKey = 'devices' | 'process';
type ProcessTabKey = 'blacklist' | 'whitelist' | 'killlog';

const PROCESS_TABS: ProcessTabKey[] = ['blacklist', 'whitelist', 'killlog'];

const PROCESS_LABELS: Record<ProcessTabKey, string> = {
  blacklist: '进程黑名单',
  whitelist: '进程白名单',
  killlog: '杀进程日志',
};

const asProcessTab = (v: string | null): ProcessTabKey =>
  (PROCESS_TABS as string[]).includes(v || '') ? (v as ProcessTabKey) : 'blacklist';

/** 地址栏 → 页签。老链接只带 ?tab=，这里把「进程那三个 key」认出来，其余一律落「电脑」。 */
function parse(searchParams: URLSearchParams): { view: ViewKey; tab: ProcessTabKey } {
  const view = searchParams.get('view');
  if (view === 'process') return { view: 'process', tab: asProcessTab(searchParams.get('tab')) };
  if (view === 'devices') return { view: 'devices', tab: asProcessTab(searchParams.get('tab')) };
  const rawTab = searchParams.get('tab');
  if (rawTab && (PROCESS_TABS as string[]).includes(rawTab)) {
    return { view: 'process', tab: rawTab as ProcessTabKey };
  }
  return { view: 'devices', tab: 'blacklist' };
}

const ClientManagementPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = parse(searchParams);
  const [view, setView] = useState<ViewKey>(initial.view);
  const [tab, setTab] = useState<ProcessTabKey>(initial.tab);

  // 从老地址重定向过来时同步页签；在页签之间点来点去时值已经一样，不会互相打架。
  useEffect(() => {
    const next = parse(searchParams);
    setView(next.view);
    setTab(next.tab);
  }, [searchParams]);

  const changeView = (next: ViewKey, nextTab: ProcessTabKey = tab) => {
    setView(next);
    setTab(nextTab);
    setSearchParams(
      next === 'process' ? { view: 'process', tab: nextTab } : { view: 'devices' },
      { replace: true },
    );
  };

  return (
    <div>
      <PageHeader
        title='客户端管理'
        subtitle='本店电脑从装机到上线都在这一页：台账 / 远程控制 / 客户端版本合成了一张表，进程名单和杀进程记录在第二个页签'
      />
      <Tabs
        activeKey={view}
        animated={false}
        onChange={(k) => changeView(k as ViewKey)}
        items={[
          { key: 'devices', label: '电脑' },
          { key: 'process', label: '进程名单' },
        ]}
      />
      {view === 'devices' && <DevicesPanel />}
      {view === 'process' && (
        <>
          <Segmented
            style={{ marginBottom: 12 }}
            value={tab}
            onChange={(v) => changeView('process', v as ProcessTabKey)}
            options={PROCESS_TABS.map((k) => ({ label: PROCESS_LABELS[k], value: k }))}
          />
          {tab === 'blacklist' && <BlacklistPage embedded />}
          {tab === 'whitelist' && <WhitelistPage embedded />}
          {tab === 'killlog' && <ProcessKillLogPage embedded />}
        </>
      )}
    </div>
  );
};

export default ClientManagementPage;