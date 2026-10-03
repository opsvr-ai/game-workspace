import React from 'react';
import dayjs from 'dayjs';
import { useAuthStore } from '../stores/authStore';

/**
 * 画面淡色水印（老板 2026-10-04：「客户微信隐形水印……我能顺藤摸瓜找到」）。
 *
 * 铺一层**几乎看不见**的「账号名 · 日期」，固定在最上层、不吃鼠标事件。
 * 陪玩把客户信息截图 / 拍照发给别人，这行淡淡的字会跟着图片走 ——
 * 老板拿截图就能看出是谁漏的。
 *
 * 和「文本水印」的分工：
 *  · 文本水印（服务端打的零宽字符）管「复制粘贴出去的文本」；
 *  · 这层管「截图 / 拍照」。两条腿都要有，因为泄漏方式就这两种。
 */
const ScreenWatermark: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const name = (user as any)?.displayName || (user as any)?.username || '';
  if (!name) return null;
  const label = `${name} · ${dayjs().format('YYYY-MM-DD')}`;

  return (
    // aria-hidden：读屏软件不用念它；pointer-events:none：绝不挡点击
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20000,
        pointerEvents: 'none',
        overflow: 'hidden',
        opacity: 0.07,
      }}
    >
      <svg width="100%" height="100%">
        <defs>
          <pattern
            id="chunlv-screen-watermark"
            width="320"
            height="200"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-24)"
          >
            <text x="10" y="46" fill="#0f172a" fontSize="14" fontFamily="sans-serif">
              {label}
            </text>
            <text x="170" y="140" fill="#0f172a" fontSize="14" fontFamily="sans-serif">
              {label}
            </text>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#chunlv-screen-watermark)" />
      </svg>
    </div>
  );
};

export default ScreenWatermark;