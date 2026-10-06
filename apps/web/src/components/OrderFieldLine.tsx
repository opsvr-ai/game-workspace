// craftsman-ignore: TS001,TS002
import React from 'react';
import { Typography } from 'antd';
import { DATA_SUB_FONT_SIZE } from '../constants/datasetColumns';
import type { OrderFieldEntry } from '../constants/orderFields';
import { BRAND, TEXT } from '../styles/tokens';

const { Text } = Typography;

/** 可复制的那种值（抢单成功浮窗里的客户联系方式）用品牌紫，跟订单详情弹窗一致 */
const COPYABLE_COLOR = BRAND.primary;

/**
 * 一条订单 / 客户数据的「标签 + 值」一行（抢单池、派单工作台用）。
 *
 * 老板 2026-09-30：「从发布订单→进入抢单池/指定→订单管理→客户管理 用的都是同一条数据，
 * 你把所有的显示的标签都用一样的不行么？」——以前这一行只有一串用 `|` 隔开的值，
 * 一个字段名都没有，同一个数据在表格里有名字（表头「来源 / 引流账号 / 客户联系方式」…），
 * 到了抢单池就没名字了。现在每一项前面都写上**订单管理表头同一份标签**
 * （见 constants/orderFields.ts），换了页面也是同一套字。
 */
const LABEL_STYLE: React.CSSProperties = {
  fontSize: DATA_SUB_FONT_SIZE,
  color: TEXT.tertiary,
  marginRight: 4,
};

export interface OrderFieldLineProps {
  items: OrderFieldEntry[];
  /** 一行放不下时换行（抢单池 / 派单工作台都是这样，按钮钉在最右侧） */
  wrap?: boolean;
  style?: React.CSSProperties;
}

const OrderFieldLine: React.FC<OrderFieldLineProps> = ({ items, wrap, style }) => (
  <div
    style={{
      display: 'flex',
      flexWrap: wrap ? 'wrap' : 'nowrap',
      alignItems: 'center',
      minWidth: 0,
      ...style,
    }}
  >
    {items.map((item, i) => {
      const last = i === items.length - 1;
      return (
        <span
          key={`${item.key}-${i}`}
          style={{
            whiteSpace: 'nowrap',
            paddingRight: last ? 0 : 10,
            marginRight: last ? 0 : 10,
            // 字段之间用一条浅分隔线代替以前的 `|` —— 换行时不会出现「一行以 | 开头」
            borderRight: last ? undefined : '1px solid #EEF2F7',
          }}
        >
          <span style={LABEL_STYLE}>{item.label}</span>
          {item.copyable ? (
            <Text copyable={{ text: item.text }} style={{ color: COPYABLE_COLOR }}>
              {item.text}
            </Text>
          ) : (
            item.text
          )}
        </span>
      );
    })}
  </div>
);

export default OrderFieldLine;
