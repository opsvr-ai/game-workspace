// craftsman-ignore: TS001,TS002
import React from 'react';
import { Tabs, Typography } from 'antd';
import RevenueSettings from '../settings/RevenueSettings';
import PaymentSettings from '../settings/PaymentSettings';
import StudioSettings from '../settings/StudioSettings';
import NotificationSettings from '../settings/NotificationSettings';
import AttendanceSettings from '../settings/AttendanceSettings';
import CaptureSettings from '../settings/CaptureSettings';

const { Text, Title } = Typography;

const SettingsPage: React.FC = () => {
  const tabItems = [
    { key: 'revenue', label: '💰 流水与价格 + 支取', children: <RevenueSettings /> },
    { key: 'payment', label: '📊 分账规则', children: <PaymentSettings /> },
    { key: 'studio', label: '⚙️ 运营设置', children: <StudioSettings /> },
    { key: 'capture', label: '📸 截图阈值', children: <CaptureSettings /> },
    // TODO: notification/attendance features coming soon
  ];

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>
          系统设置
        </Title>
        <Text type="secondary">管理系统全局配置项，修改后即时生效</Text>
      </div>
      <Tabs defaultActiveKey="revenue" items={tabItems} />
    </div>
  );
};

export default SettingsPage;
