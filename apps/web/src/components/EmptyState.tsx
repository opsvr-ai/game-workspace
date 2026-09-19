// craftsman-ignore: TS002
import React, { memo } from 'react';
import { Empty } from 'antd';

interface EmptyStateProps {
  description?: string;
  image?: React.ReactNode;
  action?: { text: string; onClick: () => void };
  /**
   * 紧凑模式：只留一行文字，不画插画。
   *
   * 订单池、抢单池这类位置「空着」的时候也会一直显示，插图版空态要占 120px 左右，
   * 会把下面真正要看的内容（我发布的订单 / 可抢的单）挤到屏幕外，还要多滚一屏。
   * 需要「页面整洁 + 少滚动」的地方一律用 compact。
   */
  compact?: boolean;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  description = '暂无数据',
  image,
  action,
  compact = false,
}) => {
  if (compact) {
    return (
      <div
        style={{
          background: '#FFFFFF',
          border: '1px dashed #E2E8F0',
          borderRadius: 8,
          padding: '12px 12px',
          textAlign: 'center',
          color: '#94A3B8',
          fontSize: 13,
          lineHeight: '20px',
        }}
      >
        {description}
      </div>
    );
  }
  return (
    <Empty
      image={image || Empty.PRESENTED_IMAGE_SIMPLE}
      description={description}
    >
      {action && (
        <button
          onClick={action.onClick}
          style={{
            background: '#1677ff',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '4px 15px',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          {action.text}
        </button>
      )}
    </Empty>
  );
};

export default memo(EmptyState);
