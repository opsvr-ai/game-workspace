// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Alert, Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ordersApi } from '../api/orders';
import { useAuthStore } from '../stores/authStore';
import { visibleInterval } from '../hooks/usePolling';
import { customerLabelOf, dueFollowUpAtOf, lastFollowUpOf, mmddhhmm } from '../utils/followUp';

/**
 * 首页上的「到点该跟进了」提示（老板 2026-09-29）。
 *
 * 客服在跟进台账里记跟进时写了「下次跟进时间」，时间一过，这里就在首页顶上拉一条红条
 * （写清楚是哪几位客户、最近一次聊到哪一步），点一下就跳到「管理端直添客户流转明细」去跟
 * （老板 2026-09-30：「客服跟进台账」并进那一页了）。
 * 没有到点的客户时**什么都不显示**，不占地方。
 */
const DueFollowUpBanner: React.FC = () => {
  const role = useAuthStore((s) => s.user?.role);
  const navigate = useNavigate();
  const [due, setDue] = useState<any[]>([]);
  const canSee = role === 'CS' || role === 'ADMIN' || role === 'OWNER';
  const ledgerPath = role === 'CS' ? '/cs/dispatch?tab=converted' : '/admin/dispatch?tab=converted';

  useEffect(() => {
    if (!canSee) return;
    const load = async () => {
      try {
        const { data } = await ordersApi.csFollowup();
        const now = Date.now();
        setDue((data.data || []).filter((row: any) => dueFollowUpAtOf(row, now) !== null));
      } catch {
        // 拉不到就当没有到点的客户：首页不该因为这条提示而报错
      }
    };
    load();
    const t = visibleInterval(load, 300000);
    return () => clearInterval(t);
  }, [canSee]);

  if (!canSee || due.length === 0) return null;

  const names = due.slice(0, 3).map((row) => customerLabelOf(row)).join('、');
  const more = due.length > 3 ? ` 等 ${due.length} 位` : '';
  const earliest = due
    .map((row) => lastFollowUpOf(row)?.nextFollowUpAt || '')
    .sort()[0];

  return (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 12 }}
      message={
        <span>
          到点了该跟进：<b>{names}</b>
          {more ? <span>{more}</span> : null}
          {earliest ? <span style={{ color: '#B91C1C' }}>（最早一条 {mmddhhmm(earliest)} 就该跟了）</span> : null}
        </span>
      }
      action={
        <Button size="small" danger onClick={() => navigate(ledgerPath)}>
          去跟进
        </Button>
      }
    />
  );
};

export default DueFollowUpBanner;
