// craftsman-ignore: TS002,TS003
import React, { memo } from 'react';
import { Typography, Breadcrumb } from 'antd';
import { useNavigate } from 'react-router-dom';
import { GRADIENTS } from '../styles/tokens';

const { Title, Text } = Typography;

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  extra?: React.ReactNode;
  breadcrumb?: { title: string; path?: string }[];
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, extra, breadcrumb }) => {
  const navigate = useNavigate();

  return (
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
        {breadcrumb && breadcrumb.length > 0 && (
          <Breadcrumb
            style={{ marginBottom: 4 }}
            items={breadcrumb.map((item) => ({
              title: item.path ? (
                <a onClick={() => navigate(item.path!)}>{item.title}</a>
              ) : (
                item.title
              ),
            }))}
          />
        )}
        {/* 标题渐变走 GRADIENTS.titleText（浅色区可读的那一档），不是深色顶栏那套霓虹渐变 */}
        <Title level={5} style={{ margin: 0, fontSize: 20, fontWeight: 700, background: GRADIENTS.titleText, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          {title}
        </Title>
        {subtitle && (
          <Text type="secondary" style={{ fontSize: 13, marginTop: 4, display: 'block' }}>
            {subtitle}
          </Text>
        )}
      </div>
      {extra && <div>{extra}</div>}
    </div>
  );
};

export default memo(PageHeader);
