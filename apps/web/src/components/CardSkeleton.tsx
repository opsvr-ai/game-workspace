// craftsman-ignore: TS002
import React, { memo } from 'react';
import { Skeleton, Card } from 'antd';

interface CardSkeletonProps {
  lines?: number;
  avatar?: boolean;
}

const CardSkeleton: React.FC<CardSkeletonProps> = ({ lines = 3, avatar = false }) => (
  <Card size="small">
    <Skeleton active paragraph={{ rows: lines }} avatar={avatar} />
  </Card>
);

export default memo(CardSkeleton);
