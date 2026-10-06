import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 统一提示出口（utils/feedback.ts）。
 *
 * 为什么要测这个：全站 600 多处提示都从这里出去，去重窗口一旦写错，后果是
 * 「该看到的提示被吞了」（漏掉报错，老板不知道操作失败了）—— 这比「多弹两条」严重得多。
 * 所以这里把边界钉住：同级别 + 同文案才去重；过了窗口、换了级别、换了文案、认不出文案，
 * 都必须照弹。真身由 vi.mock 顶掉，不真的往页面上弹（测试环境也没有 antd 的容器）。
 */

vi.mock('antd', () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

import { message as antd } from 'antd'; // feedback-layer-ok: 这里就是要拿 antd 的真身，断言「转发有没有发生」—— 不是在页面里弹提示。
import { FEEDBACK_DEDUP_MS, message, resetFeedbackDedup } from '../utils/feedback';

const at = () => new Date('2026-10-07T10:00:00+08:00');

describe('反馈层（统一提示出口）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at());
    resetFeedbackDedup();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('同一句话连着弹只留一条（双击保存 / 接口重试 / 重连那类）', () => {
    message.error('保存失败');
    message.error('保存失败');
    expect(antd.error).toHaveBeenCalledTimes(1);
  });

  it('过了去重窗口再弹，还能看到', () => {
    message.error('加载失败');
    vi.advanceTimersByTime(FEEDBACK_DEDUP_MS + 1);
    message.error('加载失败');
    expect(antd.error).toHaveBeenCalledTimes(2);
  });

  it('级别不同各算一条（成功提示不该吞掉报错）', () => {
    message.error('已处理');
    message.success('已处理');
    message.warning('已处理');
    message.info('已处理');
    expect(antd.error).toHaveBeenCalledTimes(1);
    expect(antd.success).toHaveBeenCalledTimes(1);
    expect(antd.warning).toHaveBeenCalledTimes(1);
    expect(antd.info).toHaveBeenCalledTimes(1);
  });

  it('文案不同各弹各的', () => {
    message.error('A 单保存失败');
    message.error('B 单保存失败');
    expect(antd.error).toHaveBeenCalledTimes(2);
  });

  it('对象写法 message.error({ content }) 也认得出去重', () => {
    message.error({ content: '提交失败' });
    message.error({ content: '提交失败' });
    expect(antd.error).toHaveBeenCalledTimes(1);
  });

  it('认不出文案（传的是 ReactNode / null）就不去重 —— 宁可多弹，也别把该看到的吞掉', () => {
    message.error(null);
    message.error(null);
    expect(antd.error).toHaveBeenCalledTimes(2);
  });

  it('参数原样转发给 antd（调用点一个字都不用改）', () => {
    message.warning('注意网络', 3);
    expect(antd.warning).toHaveBeenCalledWith('注意网络', 3);
  });

  it('message.raw 是「每次都弹、绝不去重」的逃生口', () => {
    message.raw.error('原样弹');
    message.raw.error('原样弹');
    expect(antd.error).toHaveBeenCalledTimes(2);
  });

  it('去重只按「同一句话」算，不连带影响别的文案', () => {
    message.error('同一句');
    message.error('同一句');
    message.error('另一句');
    message.error('同一句');
    expect(antd.error).toHaveBeenCalledTimes(2);
  });
});
