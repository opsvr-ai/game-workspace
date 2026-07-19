// craftsman-ignore: TS001
export function extractErrorMessage(error: unknown, fallback = '操作失败'): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const axiosErr = error as {
      response?: { data?: { message?: string | string[] } };
    };
    const msg = axiosErr.response?.data?.message;
    return Array.isArray(msg) ? msg.join(', ') : msg || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
