// craftsman-ignore: TS002
/**
 * 统一的「正在加载」占位（配合 docs/REFACTOR-PLAN.md 加载态统一那一批）。
 *
 * 背景：全站的「正在加载」原来有四种画法 —— 光秃秃一个大转圈飘在白框中间、
 * `<Spin tip="加载中...">`、塞在 `<Card>` 里再补一句 `padding: 50`、
 * 有的地方干脆用空态插画冒充加载中。同一种「还没来」在不同页面长得都不一样，
 * 而且没有一处写明最少占多高，于是**一加载整页就跳一下**，切页看着很晃。
 *
 * 规矩：
 *  1. 页面 / 区块「第一次加载」一律用本组件，不要再手写 div + Spin；
 *  2. 高度用 minHeight 显式给（页面级 200 上下，卡片内 120~200，列表内 120），
 *     让骨架先占住位置、内容回来时不再抖动；
 *  3. 「空数据」是空态（EmptyState）、「加载失败」是报错条，都**不是**加载中，
 *     三者别混用；
 *  4. 「刷新时的转圈遮罩」（内容已经在了、只是正在重取）用 `<Spin spinning>` 包着，
 *     那是另一种语义，不用本组件。
 */
import React, { memo } from 'react';
import { Spin } from 'antd';
import { TEXT } from '../styles/tokens';

interface LoadingStateProps {
  /** 加载文案，默认「加载中…」；传空字符串则只留转圈 */
  tip?: string;
  /** 最少占位高度（px）—— 显式给，避免内容回来时页面上下跳 */
  minHeight?: number;
  /** 转圈大小 */
  size?: 'small' | 'default' | 'large';
}

const LoadingState: React.FC<LoadingStateProps> = ({
  tip = '加载中…',
  minHeight = 180,
  size = 'default',
}) => (
  <div
    role="status"
    aria-live="polite"
    aria-label={tip || '加载中'}
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      width: '100%',
      minHeight,
      padding: '16px 0',
    }}
  >
    <Spin size={size} />
    {tip ? (
      <span style={{ color: TEXT.tertiary, fontSize: 13, lineHeight: '20px' }}>{tip}</span>
    ) : null}
  </div>
);

export default memo(LoadingState);
