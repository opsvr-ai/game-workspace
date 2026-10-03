// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { Card, TimePicker, Button, Typography, Space, Switch, Row, Col, Divider, Tag, message } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { configApi } from '../../api/config';
import { SettingsLabel } from '../../components/settings/SettingsField';

const { Text } = Typography;

/**
 * 考勤设置（老板 2026-10-04：「再加一个客服、店长考勤时间，给每个职位加一个开关，
 * 我有的职位暂时不需要开考勤」）。
 *
 * 三个职位各一套，互不影响：
 * - 陪玩沿用老键 attendance.workStart / attendance.workEnd；
 * - 客服 / 店长各自一套，都按「本店店长填的 → 老板全局默认」解析。
 * 关掉某个职位的开关 = 那个职位不记考勤（陪玩不再自动打卡；客服 / 店长的考勤也不参与
 * 工资里的扣款与全勤奖）。
 */
type RoleBlock = {
  key: 'companion' | 'cs' | 'manager';
  title: string;
  note: string;
  enabledKey: string;
  startKey: string;
  endKey: string;
};

const BLOCKS: RoleBlock[] = [
  {
    key: 'companion',
    title: '🎮 陪玩考勤',
    note: '陪玩客户端上线记上班、下线记下班，自动判定迟到、早退。关掉后不再自动打卡（考勤管理里不再新增记录）。',
    enabledKey: 'attendance.companion.enabled',
    startKey: 'attendance.workStart',
    endKey: 'attendance.workEnd',
  },
  {
    key: 'cs',
    title: '💬 客服考勤',
    note: '客服端一上线自动打上班卡（晚于上班时间记迟到），下线（超过宽限期）打下班卡，早于下班时间记早退。管理端手动登记的一律优先，不会被自动打卡覆盖。关掉后考勤不参与工资扣款与全勤奖。',
    enabledKey: 'attendance.cs.enabled',
    startKey: 'attendance.cs.workStart',
    endKey: 'attendance.cs.workEnd',
  },
  {
    key: 'manager',
    title: '🧑‍💼 店长考勤',
    note: '跟客服同一套口径。如果店长不需要考勤，把上面这个开关关掉即可。',
    enabledKey: 'attendance.manager.enabled',
    startKey: 'attendance.manager.workStart',
    endKey: 'attendance.manager.workEnd',
  },
];

const AttendanceSettings: React.FC = () => {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await configApi.getAll();
      setConfig(data.data);
    } catch {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const update = (key: string, value: string | boolean) =>
    setConfig((c: any) => ({ ...c, [key]: value }));

  const isOn = (key: string) => config?.[key] !== false; // 没配过 = 开（跟服务端一致）

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      for (const b of BLOCKS) {
        body[b.enabledKey] = isOn(b.enabledKey);
        body[b.startKey] = config?.[b.startKey] ?? '09:00';
        body[b.endKey] = config?.[b.endKey] ?? '18:00';
      }
      await configApi.update(body);
      message.success('考勤设置已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toTime = (v: any, fallback = '09:00'): Dayjs => {
    const d = dayjs(v, 'HH:mm');
    return d.isValid() ? d : dayjs(fallback, 'HH:mm');
  };

  if (loading && !config) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">加载中...</Text></div>;
  }

  return (
    <div>
      <Card
        title="🕘 考勤设置（陪玩 / 客服 / 店长，各自可单独关闭）"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button type="primary" icon={React.createElement(SaveOutlined)} loading={saving} onClick={save}>保存</Button>
          </Space>
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          每个职位可以单独开关：<b>打开</b> = 按下面这套上下班时间自动判定迟到、早退；
          <b>关闭</b> = 这个职位暂时不做考勤，也不参与工资里的考勤扣款 / 全勤奖。
        </Text>
        {BLOCKS.map((b, idx) => {
          const on = isOn(b.enabledKey);
          return (
            <div key={b.key}>
              {idx > 0 && <Divider style={{ margin: '14px 0' }} />}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <Text strong style={{ fontSize: 14 }}>{b.title}</Text>
                <Switch
                  checked={on}
                  onChange={(v) => update(b.enabledKey, v)}
                  checkedChildren="启用"
                  unCheckedChildren="关闭"
                />
                {!on && <Tag color="default">已关闭考勤</Tag>}
              </div>
              <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 10 }}>
                {b.note}
              </Text>
              <Row gutter={24}>
                <Col span={12}>
                  <div style={{ marginBottom: 12 }}>
                    <SettingsLabel>上班时间</SettingsLabel>
                    <TimePicker
                      format="HH:mm"
                      disabled={!on}
                      value={toTime(config?.[b.startKey])}
                      onChange={(d) => d && update(b.startKey, d.format('HH:mm'))}
                    />
                  </div>
                </Col>
                <Col span={12}>
                  <div style={{ marginBottom: 12 }}>
                    <SettingsLabel>下班时间</SettingsLabel>
                    <TimePicker
                      format="HH:mm"
                      disabled={!on}
                      value={toTime(config?.[b.endKey], '18:00')}
                      onChange={(d) => d && update(b.endKey, d.format('HH:mm'))}
                    />
                  </div>
                </Col>
              </Row>
            </div>
          );
        })}
      </Card>
    </div>
  );
};

export default AttendanceSettings;
