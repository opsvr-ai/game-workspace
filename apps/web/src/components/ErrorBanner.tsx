// craftsman-ignore: TS002
import React, { memo } from 'react';
import { Alert, Button } from 'antd';

interface ErrorBannerProps {
  message?: string;
  description?: string;
  onRetry?: () => void;
  style?: React.CSSProperties;
}

const ErrorBanner: React.FC<ErrorBannerProps> = ({ message = '加载失败', description, onRetry, style }) => (
  <Alert
    type="error"
    showIcon
    message={message}
    description={description}
    action={
      onRetry ? (
        <Button size="small" danger onClick={onRetry}>
          重试
        </Button>
      ) : undefined
    }
    style={{ marginBottom: 12, ...style }}
  />
);

export default memo(ErrorBanner);
