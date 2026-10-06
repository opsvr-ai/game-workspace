// craftsman-ignore: TS001,TS002
import '@testing-library/jest-dom/vitest';

/**
 * jsdom 里缺的浏览器 API，在这里补齐 —— 不补的话 antd 一渲染就抛异常，
 * 而报错信息（`matchMedia is not a function`）跟业务毫无关系，白折腾。
 * 只补「渲染路径上真的会用到」的，多余的一个不加。
 */
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
const globals = globalThis as unknown as Record<string, unknown>;
for (const name of ['ResizeObserver', 'IntersectionObserver']) {
  if (!globals[name]) globals[name] = NoopObserver;
}

// jsdom 没实现滚动，antd 的表格 / 抽屉会在挂载时调它
window.scrollTo = (() => {}) as unknown as typeof window.scrollTo;
Element.prototype.scrollIntoView = (() => {}) as unknown as typeof Element.prototype.scrollIntoView;
