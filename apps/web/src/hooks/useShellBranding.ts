/**
 * 门店品牌 / 客户端版本 / 前端构建 / 提成底薪 / 分账比例 —— 从 layouts/AppLayout.tsx 原样搬出。
 *
 * 收拢：
 *   - studioBrand（/studios/public，按当前 studioId 找名字，顶栏那个「门店 chip」）；
 *   - appVersion（Electron getAppVersion）+ webBuild（/agent/heartbeat 每 60 秒查前端构建号，
 *     要不要整页刷新由 utils/buildRefresh.ts 判定，可见性判断原样保留）；
 *   - myCommission / mySalary（客服的「本月预计提成 / 底薪+提奖」弹窗）；
 *   - shareRatios（左侧菜单业绩比例小字，和「设置 → 分账规则」同源配置）；
 *   - 客服端 / 陪玩端版本上报（/agent/cs-heartbeat，每 60 秒 + 恢复可见补报）。
 *
 * 请求路径、轮询间隔（60s）、document.visibilityState 判断、文案全部沿用原值。
 */
import React, { useEffect } from 'react';
import type { UserInfo } from '@chunlv/shared';
import http from '../api/client';
import { configApi } from '../api/config';
import { decideBuildRefresh } from '../utils/buildRefresh';
import { isAnyBusy } from '../utils/busyGuard';
import { scheduleCompanionUpdate } from '../utils/companionUpdate';

export function useShellBranding(user: UserInfo | null) {
  const [studioBrand, setStudioBrand] = React.useState<{ name: string; logo?: string } | null>(null);
  const [appVersion, setAppVersion] = React.useState('');
  const [webBuild, setWebBuild] = React.useState('');
  const [myCommission, setMyCommission] = React.useState<number | null>(null);
  const [mySalary, setMySalary] = React.useState<any>(null);
  const [salaryOpen, setSalaryOpen] = React.useState(false);
  // 左侧栏「工资 / 提成」后面那点比例：陪玩 / 店长 / 客服各拿业绩的百分之几。
  // 和「设置 → 分账规则」是同一份配置（页面加载一次，改完设置刷新页面即同步）。
  const [shareRatios, setShareRatios] = React.useState<Record<string, number | null>>({});
  React.useEffect(() => {
    if (user?.role !== 'OWNER' && user?.role !== 'ADMIN') return;
    configApi
      .get([
        'revenue.share_tiers',
        'revenue.club_companion_share',
        'commission.cs_offline_rate_percent',
        'commission.admin_offline_rate_percent',
      ])
      .then(({ data }: any) => {
        const cfg = data?.data ?? {};
        const tiers = Array.isArray(cfg['revenue.share_tiers']) ? cfg['revenue.share_tiers'] : [];
        const companions = tiers
          .map((t: any) => Number(t?.companion))
          .filter((n: number) => Number.isFinite(n));
        setShareRatios({
          // 陪玩那一栏按业绩有多个档，左侧栏显示**最高那一档**，一眼看到最好能拿到多少。
          companion: companions.length
            ? Math.max(...companions)
            : Number(cfg['revenue.club_companion_share']) || null,
          admin: Number(cfg['commission.admin_offline_rate_percent']) || 0,
          cs: Number(cfg['commission.cs_offline_rate_percent']) || 0,
        });
      })
      .catch(() => {});
  }, [user?.role]);
  useEffect(() => {
    const api = (window as any).electronAPI;
    api?.getAppVersion?.().then((v: string) => setAppVersion(v || '')).catch(() => {});
  }, []);
  useEffect(() => {
    const pageStartedAt = Date.now();
    const send = () => {
      http
        .post('/agent/heartbeat', { agentVersion: appVersion || undefined })
        .then((res: any) => {
          const id = res?.data?.data?.webBuildId;
          if (!id) return;
          setWebBuild(id);
          const inService = !!res?.data?.data?.inService;
          const prev = localStorage.getItem('webBuildId');
          if (!prev) {
            localStorage.setItem('webBuildId', id);
            return;
          }
          // 陪玩：只在非接单模式自动更新；接单中 / 有邀请 / 正在写东西完全不动。
          // 更新前留 5 秒，开始首单或收到邀请可以取消（见 companionUpdate.ts）。
          if (user?.role === 'COMPANION') {
            if (prev !== id && !inService && !isAnyBusy()) scheduleCompanionUpdate(id);
            return;
          }
          localStorage.setItem('webBuildId', id);
          // 管理端/浏览器不自动 reload，只记构建号；右下角按钮提示手动刷新。
          void decideBuildRefresh({
            prev,
            next: id,
            pageAgeMs: Date.now() - pageStartedAt,
            lastReloadAt: Number(localStorage.getItem('webBuildReloadAt') || 0),
            inService,
            busy: isAnyBusy(),
          });
        })
        .catch(() => {});
    };
    send();
    // 前端版本检查：每 60 秒一次；页面不可见（最小化 / 切到后台）时跳过。
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') send();
    }, 60_000);
    return () => clearInterval(timer);
  }, [appVersion]);
  useEffect(() => {
    if (user?.role === 'CS') {
      http
        .get('/finance/commission/my-month')
        .then(({ data }: any) => {
          const rows = data?.data?.rows;
          setMyCommission(rows?.[0]?.totalYuan ?? 0);
        })
        .catch(() => {});
      http
        .get('/finance/commission/my-salary')
        .then(({ data }: any) => setMySalary(data?.data || null))
        .catch(() => {});
    }
  }, [user?.role]);
  useEffect(() => {
    if (user?.studioId) {
      http
        .get('/studios/public')
        .then(({ data }) => {
          const s = (data.data || []).find((s: any) => s.id === user.studioId);
          if (s) setStudioBrand({ name: s.name });
        })
        .catch(() => {});
    }
  }, [user?.studioId]);

  // 客服端/陪玩端版本上报，让管理端能直接看到各客户端版本
  useEffect(() => {
    if (!user?.id) return;
    if (user.role === 'COMPANION') return; // 陪玩端走 /agent/heartbeat + WebSocket，不报 cs-heartbeat
    const api = (window as any).electronAPI;
    if (!api?.getAppVersion) return;
    // 这台电脑跑的是哪个客户端：客服端没有 onStatusChanged 这类陪玩端专属接口。
    // 注意别再用 setRole 判断 —— 2026-10-17 客服端外壳也补了 setRole（登录什么就是什么），
    // 再按它判断会把客服端误报成陪玩端，版本对比就会拿陪玩端的版本号去比。
    // 不分开的话，老板 / 店长用陪玩端登录时也会报一条「客服端版本」，
    // 管理端看起来就是「黄浩 未更新」这种假警报（那台机器上根本没装客服端）。
    const clientKind = api.onStatusChanged ? 'companion' : 'cs';
    const report = () => {
      api.getAppVersion().then((v: string) => {
        http.post('/agent/cs-heartbeat', { agentVersion: v, clientKind }).catch(() => {});
      }).catch(() => {});
    };
    report();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') report();
    }, 60_000);
    // 老板 2026-09-21 报「hanlei1 又掉线了」：窗口最小化 / 收进托盘时浏览器不发心跳，
    // 人员列表就把他算成离线。窗口一恢复可见立刻补报一次，秒回在线。
    const onVisible = () => {
      if (document.visibilityState === 'visible') report();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user?.id, user?.role]);
  return {
    studioBrand,
    myCommission,
    mySalary,
    salaryOpen,
    setSalaryOpen,
    shareRatios,
  };
}
