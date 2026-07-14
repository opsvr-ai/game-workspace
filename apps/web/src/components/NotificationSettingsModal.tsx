import React, { useState, useEffect } from 'react';
import { Modal, Switch, Row, Col, Tag, Typography, Spin } from 'antd';

const { Text } = Typography;

const SECTIONS = [
  { title: '订单类型', key: 'orderTypes', items: [
    { k: 'NEW', l: '首单', c: '#1677ff' },{ k: 'RENEW', l: '续费', c: '#00D4FF' },
    { k: 'REPURCHASE', l: '复购', c: '#7B61FF' },{ k: 'TIP', l: '打赏', c: '#FF9100' },
  ]},
  { title: '服务类型', key: 'serviceTypes', items: [
    { k: 'PLAY_WITH', l: '陪玩', c: '#1677ff' },{ k: 'ESCORT', l: '护航', c: '#FF9100' },
    { k: 'DO_TASK', l: '任务', c: '#7B61FF' },
  ]},
  { title: '派单方式', key: 'dispatchTypes', items: [
    { k: 'POOL', l: '抢单池', c: '#1677ff' },{ k: 'DIRECT', l: '直接派', c: '#52c41a' },
  ]},
  { title: '打单时间', key: 'urgency', items: [
    { k: 'now', l: '⚡立即', c: '#52c41a' },{ k: 'later', l: '预约', c: '#7B61FF' },
  ]},
  { title: '计费方式', key: 'billingMode', items: [
    { k: 'hour', l: '按小时', c: '#1677ff' },{ k: 'round', l: '按局', c: '#52c41a' },
  ]},
  { title: '陪陪数量', key: 'deltaCount', items: [
    { k: '单', l: '单', c: '#1677ff' },{ k: '双', l: '双', c: '#7B61FF' },
  ]},
];

const DEFAULTS: any = {
  enabled: true,
  orderTypes: { NEW: true, RENEW: true, REPURCHASE: true, TIP: true },
  serviceTypes: { PLAY_WITH: true, ESCORT: true, DO_TASK: true },
  dispatchTypes: { POOL: true, DIRECT: true },
  urgency: { now: true, later: true },
  billingMode: { hour: true, round: true },
  deltaCount: { '单': true, '双': true },
};

const NotificationSettingsModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [prefs, setPrefs] = useState<any>(DEFAULTS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const api = (window as any).electronAPI;
    if (api?.storeGet) {
      api.storeGet('notificationPrefs').then((p: any) => {
        if (p?.orderTypes) {
          setPrefs({
            ...DEFAULTS,
            ...p,
            orderTypes: { ...DEFAULTS.orderTypes, ...p.orderTypes },
            serviceTypes: { ...DEFAULTS.serviceTypes, ...p.serviceTypes },
            dispatchTypes: { ...DEFAULTS.dispatchTypes, ...p.dispatchTypes },
            urgency: { ...DEFAULTS.urgency, ...p.urgency },
            billingMode: { ...DEFAULTS.billingMode, ...p.billingMode },
            deltaCount: { ...DEFAULTS.deltaCount, ...p.deltaCount },
          });
        }
      }).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [open]);

  const save = (newPrefs: any) => {
    setPrefs(newPrefs);
    const api = (window as any).electronAPI;
    if (api?.storeSet) {
      api.storeSet('notificationPrefs', newPrefs).catch(() => {});
    }
  };

  return (
    <Modal title="🔔 订单通知设置" open={open} onCancel={onClose} footer={null} width={540}>
      {loading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div> : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <Text strong style={{ marginRight: 12 }}>启用通知</Text>
            <Switch checked={prefs?.enabled !== false} onChange={(v) => save({ ...prefs, enabled: v })} />
          </div>
          <Row gutter={[8, 14]}>
            {SECTIONS.map((sec) => (
              <Col span={8} key={sec.key}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>{sec.title}</Text>
                {sec.items.map(({ k, l, c }) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <Tag color={c} style={{ margin: 0, fontSize: 11, width: l.length > 2 ? 44 : 32, textAlign: 'center' }}>{l}</Tag>
                    <Switch size="small" checked={prefs?.[sec.key]?.[k] !== false} disabled={!prefs?.enabled}
                      onChange={(v) => save({ ...prefs, [sec.key]: { ...prefs?.[sec.key], [k]: v } })} />
                  </div>
                ))}
              </Col>
            ))}
          </Row>
        </>
      )}
    </Modal>
  );
};

export default NotificationSettingsModal;
