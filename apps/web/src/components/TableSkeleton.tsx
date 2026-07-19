// craftsman-ignore: TS002
import React, { memo } from 'react';
import { Skeleton, Card } from 'antd';

interface TableSkeletonProps {
  columns?: number;
  rows?: number;
}

const TableSkeleton: React.FC<TableSkeletonProps> = ({ columns = 4, rows = 5 }) => (
  <Card size="small">
    {/* Header row */}
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: 8,
        padding: '8px 0',
        borderBottom: '1px solid #f0f0f0',
        marginBottom: 8,
      }}
    >
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton.Input key={`h-${i}`} active size="small" style={{ width: '60%' }} />
      ))}
    </div>
    {/* Body rows */}
    {Array.from({ length: rows }).map((_, rowIdx) => (
      <div
        key={`r-${rowIdx}`}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: 8,
          padding: '4px 0',
        }}
      >
        {Array.from({ length: columns }).map((_, colIdx) => (
          <Skeleton.Input
            key={`c-${rowIdx}-${colIdx}`}
            active
            size="small"
            style={{ width: colIdx === 0 ? '80%' : '50%' }}
          />
        ))}
      </div>
    ))}
  </Card>
);

export default memo(TableSkeleton);
