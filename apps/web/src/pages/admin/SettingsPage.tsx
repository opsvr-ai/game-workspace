// craftsman-ignore: TS001,TS002
import React from 'react';
import { Tabs, Typography } from 'antd';
import RevenueSettings from '../settings/RevenueSettings';
import PaymentSettings from '../settings/PaymentSettings';
import StudioSettings from '../settings/StudioSettings';
import NotificationSettings from '../settings/NotificationSettings';
import AttendanceSettings from '../settings/AttendanceSettings';
import CaptureSettings from '../settings/CaptureSettings';
import DispatchCommissionSettings from '../settings/DispatchCommissionSettings';
import GameBreakEvenSettings from '../settings/GameBreakEvenSettings';
import DispatchTimingSettings from '../settings/DispatchTimingSettings';
import VoiceSettings from '../settings/VoiceSettings';

const { Text, Title } = Typography;

const SettingsPage: React.FC = () => {
  const tabItems = [
    { key: 'revenue', label: '💰 流水与价格 + 支取', children: <RevenueSettings /> },
    { key: 'payment', label: '📊 分账规则', children: <PaymentSettings /> },
    { key: 'studio', label: '⚙️ 运营设置', children: <StudioSettings /> },
    { key: 'capture', label: '📸 截图阈值', children: <CaptureSettings /> },
    { key: 'dispatch', label: '🧭 派单与提成', children: <DispatchCommissionSettings /> },
    { key: 'game-break-even', label: '🎮 游戏平衡点', children: <GameBreakEvenSettings /> },
    { key: 'dispatch-timing', label: '⏱️ 按照陪玩等级看到订单等待时间', children: <DispatchTimingSettings /> },
    { key: 'voice', label: '🎙️ 语音通话', children: <VoiceSettings /> },
    { key: 'notification', label: '🔔 通知设置', children: <NotificationSettings /> },
    { key: 'attendance', label: '🕘 考勤设置', children: <AttendanceSettings /> },
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
