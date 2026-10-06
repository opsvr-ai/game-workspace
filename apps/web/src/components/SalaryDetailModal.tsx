// craftsman-ignore: TS001,TS002
import React from 'react';
import { Modal, Typography } from 'antd';
import { BG, BORDER, BRAND } from '../styles/tokens';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  /** `/companions/me/salary` 的返回：{ month, config, row, orders } */
  salary: any;
}

/**
 * 「💰 底薪 + 提奖」明细弹窗。
 *
 * 2026-10-07 从 `layouts/AppLayout.tsx` **原样搬出来**（只把 `mySalary` 换成了 props `salary`），
 * 行为零变化。那张「订单明细」表也是逐字搬的 —— 它以前写死过 `#e5e7eb` / `#f5f7fa`，现在走令牌。
 */
const SalaryDetailModal: React.FC<Props> = ({ open, onClose, salary }) => (
  <Modal title="💰 底薪 + 提奖" open={open} onCancel={onClose} footer={null} width={720}>
    {salary?.row ? (
      <div style={{ fontSize: 13, lineHeight: 1.9 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 8 }}>
          <div>月份：<b>{salary.month}</b></div>
          <div>底薪：<b>¥{Number(salary.config.baseSalary).toFixed(2)}</b></div>
          <div>月休：<b>{salary.config.restDays} 天</b></div>
          <div>满勤：<b>{salary.fullAttendance} 天</b></div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 8 }}>
          <div>桥接单数：<b>{salary.row.bridgeUnits}</b> 单</div>
          <div>桥接单价：<b>¥{Number(salary.row.bridgePerUnitYuan).toFixed(2)}</b></div>
          <div>桥接提成：<b>¥{Number(salary.row.bridgeCommissionYuan).toFixed(2)}</b></div>
          <div>线下提成：<b>¥{Number(salary.row.offlineCommissionYuan).toFixed(2)}</b></div>
          <div>线上提成：<b>¥{Number(salary.row.onlineCommissionYuan).toFixed(2)}</b></div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 8 }}>
          <div>底薪实发：<b>¥{Number(salary.row.baseEffective).toFixed(2)}</b></div>
          <div>全勤奖：<b>¥{Number(salary.row.attendanceBonus).toFixed(2)}</b></div>
          <div>考勤扣款：<b>¥{Number(salary.row.attendanceDeduction).toFixed(2)}</b></div>
          <div>预计合计：<b style={{ color: BRAND.primary }}>¥{Number(salary.row.totalYuan).toFixed(2)}</b></div>
        </div>
        <div style={{ marginTop: 12, marginBottom: 4, fontWeight: 600 }}>订单明细</div>
        <div style={{ maxHeight: 260, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: BG.base }}>
                <th style={{ padding: 6, border: `1px solid ${BORDER.base}` }}>订单</th>
                <th style={{ padding: 6, border: `1px solid ${BORDER.base}` }}>类型</th>
                <th style={{ padding: 6, border: `1px solid ${BORDER.base}` }}>状态</th>
                <th style={{ padding: 6, border: `1px solid ${BORDER.base}` }}>微信</th>
                <th style={{ padding: 6, border: `1px solid ${BORDER.base}` }}>金额</th>
                <th style={{ padding: 6, border: `1px solid ${BORDER.base}` }}>单/双</th>
                <th style={{ padding: 6, border: `1px solid ${BORDER.base}` }}>去向</th>
                <th style={{ padding: 6, border: `1px solid ${BORDER.base}` }}>提成</th>
              </tr>
            </thead>
            <tbody>
              {(salary.orders || []).map((t: any) => (
                <tr key={t.orderId}>
                  <td style={{ padding: 6, border: `1px solid ${BORDER.base}` }}>{t.orderCode || t.orderId?.slice(0, 8)}</td>
                  <td style={{ padding: 6, border: `1px solid ${BORDER.base}` }}>{t.type}</td>
                  <td style={{ padding: 6, border: `1px solid ${BORDER.base}` }}>
                    {t.status === 'DONE' ? '✅ 已打首单' : t.status === 'CONFIRMED' ? '进行中' : t.status === 'GRABBED' ? '已抢单' : t.status || '-'}
                  </td>
                  <td style={{ padding: 6, border: `1px solid ${BORDER.base}` }}>
                    {t.contactStatus === 'added' ? '✅ 添加成功' : t.contactStatus === 'not_accepted' ? '❌ 添加失败' : t.contactStatus === 'pending' ? '待添加' : '-'}
                  </td>
                  <td style={{ padding: 6, border: `1px solid ${BORDER.base}` }}>¥{Number(t.amount).toFixed(2)}</td>
                  <td style={{ padding: 6, border: `1px solid ${BORDER.base}` }}>{t.units === 2 ? '双陪' : '单陪'}</td>
                  <td style={{ padding: 6, border: `1px solid ${BORDER.base}` }}>{t.kind === 'offline' ? '线下' : t.kind === 'bridge' ? '桥接' : '线上'}</td>
                  <td style={{ padding: 6, border: `1px solid ${BORDER.base}` }}>
                    {t.counted ? `+¥${Number(t.commissionYuan).toFixed(2)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ) : (
      <Text type="secondary">暂无工资数据</Text>
    )}
  </Modal>
);

export default SalaryDetailModal;
