// craftsman-ignore: TS001
import { useEffect, useRef } from 'react';

/**
 * 带「后台自动暂停」的轮询：
 * - 页面可见时才定时执行
 * - 切到后台/最小化时暂停，回到前台立即执行一次并恢复定时
 * 用于各类列表/角标等非关键数据的刷新，降低带宽与 CPU 占用。
 */
export function usePolling(callback: () => void, intervalMs: number) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      stop();
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') {
          cbRef.current();
        }
      }, intervalMs);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        cbRef.current();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') {
      start();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
}

/**
 * 与原生 setInterval 用法一致的替代品，但页面切到后台 / 客户端最小化时跳过执行。
 * 客户端一整天下来的常态就是最小化挂在托盘里，这些列表刷新在看不见的时候
 * 完全没必要发请求，白占带宽和 CPU。返回值可以直接交给 clearInterval。
 */
export function visibleInterval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
  return setInterval(() => {
    if (document.visibilityState === 'visible') fn();
  }, ms);
}

