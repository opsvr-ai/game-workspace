// craftsman-ignore: TS001,TS002
import React from 'react';
import { Card, Typography } from 'antd';
import { BellOutlined } from '@ant-design/icons';

const { Text } = Typography;

const IconBell = React.createElement(BellOutlined);

/** Placeholder — notification settings not yet implemented. */
const NotificationSettings: React.FC = () => (
  <Card
    title={<span>{IconBell} 通知设置</span>}
  >
    <div style={{ textAlign: 'center', padding: 40 }}>
      <Text type="secondary">通知设置功能开发中...</Text>
    </div>
  </Card>
);

export default NotificationSettings;
