// craftsman-ignore: TS002
import React, { memo } from 'react';
import { Empty } from 'antd';

interface EmptyStateProps {
  description?: string;
  image?: React.ReactNode;
  action?: { text: string; onClick: () => void };
}

const EmptyState: React.FC<EmptyStateProps> = ({
  description = '暂无数据',
  image,
  action,
}) => (
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

export default memo(EmptyState);
