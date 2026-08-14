// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { Card, TimePicker, Button, Typography, Space, message, Row, Col } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { configApi } from '../../api/config';

const { Text } = Typography;

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

  const update = (key: string, value: string) => setConfig((c: any) => ({ ...c, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await configApi.update({
        'attendance.workStart': config?.['attendance.workStart'] ?? '09:00',
        'attendance.workEnd': config?.['attendance.workEnd'] ?? '18:00',
      });
      message.success('考勤设置已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toTime = (v: any): Dayjs => {
    const d = dayjs(v, 'HH:mm');
    return d.isValid() ? d : dayjs('09:00', 'HH:mm');
  };

  if (loading && !config) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">加载中...</Text></div>;
  }

  return (
    <div>
      <Card
        title="🕘 陪玩考勤设置"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button type="primary" icon={React.createElement(SaveOutlined)} loading={saving} onClick={save}>保存</Button>
          </Space>
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          设定陪玩每日上班与下班时间，用于自动判定迟到、早退与考勤记录。
        </Text>
        <Row gutter={24}>
          <Col span={12}>
            <div style={{ marginBottom: 12 }}>
              <Text style={{ display: 'inline-block', minWidth: 190 }}>上班时间</Text>
              <TimePicker
                format="HH:mm"
                value={toTime(config?.['attendance.workStart'])}
                onChange={(d) => d && update('attendance.workStart', d.format('HH:mm'))}
              />
            </div>
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 12 }}>
              <Text style={{ display: 'inline-block', minWidth: 190 }}>下班时间</Text>
              <TimePicker
                format="HH:mm"
                value={toTime(config?.['attendance.workEnd'])}
                onChange={(d) => d && update('attendance.workEnd', d.format('HH:mm'))}
              />
            </div>
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default AttendanceSettings;
