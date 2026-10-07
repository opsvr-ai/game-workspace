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
  /** 标题**前面**放个东西 —— 详情页的「‹ 返回」这类，别在页面里再手搓一个标题行。 */
  leading?: React.ReactNode;
  /**
   * 嵌在「客户端与设备」那三个页签里（老板 2026-10-07 三页合一）：标题就是外层页签，
   * 这里不再重复画一遍大标题，只留右侧操作区（搜索 / 刷新 / 推送这些按钮）。
   */
  embedded?: boolean;
}

const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  extra,
  breadcrumb,
  leading,
  embedded,
}) => {
  const navigate = useNavigate();

  // 嵌在页签里：只留右侧操作区，标题交给外层页签（别把标题画两遍）。
  if (embedded) {
    if (!extra) return null;
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'flex-start',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div>{extra}</div>
      </div>
    );
  }

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
      {/* 左边这一块不跟着右侧操作区一起缩（缩了副标题会挤成一个字一行、甚至只剩个「~」）。
          放不下的时候让 flexWrap 把右侧操作区整块换到下一行，而不是把标题压窄。 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, flexShrink: 0, maxWidth: '100%' }}>
        {leading && <div style={{ flexShrink: 0 }}>{leading}</div>}
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
          <Text type="secondary" style={{ fontSize: 13, marginTop: 4, display: 'block', maxWidth: 780 }}>
            {subtitle}
          </Text>
        )}
        </div>
      </div>
      {extra && <div>{extra}</div>}
    </div>
  );
};

export default memo(PageHeader);
