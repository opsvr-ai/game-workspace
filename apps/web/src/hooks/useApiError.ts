import { message } from 'antd';
import { extractErrorMessage } from '../utils/error-handler';

interface UseApiErrorReturn {
  handleError: (error: unknown, fallback?: string) => void;
}

export function useApiError(defaultFallback?: string): UseApiErrorReturn {
  const handleError = (error: unknown, fallback?: string) => {
    const msg = extractErrorMessage(error, fallback || defaultFallback || '操作失败');
    message.error(msg);
  };

  return { handleError };
}
