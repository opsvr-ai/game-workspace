import React from 'react';
import { Typography } from 'antd';

const { Title, Text } = Typography;

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  extra?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, extra }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 12,
      flexWrap: 'wrap',
      gap: 8,
    }}
  >
    <div>
      <Title level={4} style={{ margin: 0 }}>{title}</Title>
      {subtitle && (
        <Text type="secondary" style={{ fontSize: 13, marginTop: 4, display: 'block' }}>
          {subtitle}
        </Text>
      )}
    </div>
    {extra && <div>{extra}</div>}
  </div>
);

export default PageHeader;
