// craftsman-ignore: TS001
import React from 'react';
import { InputNumber, Typography } from 'antd';

const { Text } = Typography;

/**
 * 设置页统一的标签列宽。
 * 以前每个页面各写各的（140 / 190 / 200），左边一栏参差不齐，
 * 切页面时输入框左右横跳。现在全部用这一个值。
 */
export const SETTINGS_LABEL_WIDTH = 180;

/** 标签独占一列，后面跟任意控件（下拉、开关、时间选择等）。 */
export const SettingsLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text style={{ display: 'inline-block', minWidth: SETTINGS_LABEL_WIDTH, marginBottom: 4 }}>
    {children}
  </Text>
);

/**
 * 数字设置项：左标签、中输入框、右说明。
 * 说明文字单独占一列自动换行，不会再被挤到标签下面去断字。
 */
export const SettingsField: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  suffix?: string;
}> = ({ label, value, onChange, min = 0, max, step = 1, hint, suffix }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
    <Text style={{ flex: `0 0 ${SETTINGS_LABEL_WIDTH}px`, paddingTop: 5, lineHeight: '22px' }}>
      {label}
    </Text>
    <InputNumber
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(v) => onChange(v ?? 0)}
      style={{ width: 130, flex: '0 0 auto' }}
    />
    {(hint || suffix) && (
      <Text
        type="secondary"
        style={{ flex: 1, minWidth: 0, paddingTop: 6, lineHeight: '18px', fontSize: 12 }}
      >
        {hint || suffix}
      </Text>
    )}
  </div>
);

export default SettingsField;
