// craftsman-ignore: TS001,TS002
import React from 'react';
import { Card, Typography } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';

const { Text } = Typography;

const IconClock = React.createElement(ClockCircleOutlined);

/** Placeholder — attendance settings not yet implemented. */
const AttendanceSettings: React.FC = () => (
  <Card
    title={<span>{IconClock} 考勤设置</span>}
  >
    <div style={{ textAlign: 'center', padding: 40 }}>
      <Text type="secondary">考勤设置功能开发中...</Text>
    </div>
  </Card>
);

export default AttendanceSettings;
