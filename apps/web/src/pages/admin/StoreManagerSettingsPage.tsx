// craftsman-ignore: TS001,TS002,TS003
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Space, Typography, message, InputNumber } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { payrollApi } from '../../api/payroll';

const { Title, Text } = Typography;

const Field = ({ label, unit, value, onChange, step = 1, min = 0, hint }: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  hint?: string;
}) => (
  <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
    <Text style={{ display: 'inline-block', minWidth: 150 }}>{label}</Text>
    <InputNumber
      min={min}
      step={step}
      value={value}
      onChange={(v) => onChange(Number(v ?? 0))}
      style={{ width: 150 }}
      suffix={<Text strong style={{ color: '#1677ff' }}>{unit}</Text>}
    />
    {hint && <Text type="secondary">{hint}</Text>}
  </div>
);

const StoreManagerSettingsPage: React.FC = () => {
  const [adminBase, setAdminBase] = useState(0);
  const [restDays, setRestDays] = useState(4);
  const [lateDeduction, setLateDeduction] = useState(0);
  const [absentDeduction, setAbsentDeduction] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await payrollApi.configs();
      const list = (data as any)?.data || [];
      const admin = list.find((p: any) => p.role === 'ADMIN') || {};
      setAdminBase(Number(admin?.baseSalary ?? 0));
      setRestDays(Number(admin?.fullAttendanceDays ?? 4));
      setLateDeduction(Number(admin?.lateDeduction ?? 0));
      setAbsentDeduction(Number(admin?.absentDeduction ?? 0));
    } catch {
      message.error('加载设置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await payrollApi.saveConfig({
        role: 'ADMIN', baseSalary: adminBase, fullAttendanceDays: restDays,
        lateDeduction, absentDeduction,
      });
      message.success('店长设置已保存');
      await load();
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>店长设置</Title>
        <Text type="secondary">店长基本工资、月休、迟到/缺勤扣款，在这里设置。</Text>
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
        <Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving}>保存全部</Button>
      </Space>

      <Card size="small" title="💰 店长工资" style={{ maxWidth: 520 }}>
        <Field label="店长基本工资" unit="元/月" value={adminBase} step={100} onChange={setAdminBase} />
        <Field label="月休天数" unit="天" value={restDays} step={1} onChange={setRestDays} hint="满勤 = 当月天数 − 月休天数" />
        <Field label="迟到扣款" unit="元/次" value={lateDeduction} step={1} onChange={setLateDeduction} />
        <Field label="缺勤扣款" unit="元/天" value={absentDeduction} step={1} onChange={setAbsentDeduction} />
      </Card>
    </div>
  );
};

export default StoreManagerSettingsPage;
