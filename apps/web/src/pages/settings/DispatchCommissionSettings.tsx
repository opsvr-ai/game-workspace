// craftsman-ignore: TS001,TS002
import React from 'react';
import { Alert, Card, Typography } from 'antd';

const { Text } = Typography;

/**
 * 派单优先级（2026-10-04 清死键）
 *
 * 这一页原来挂着三组重复的数，早就搬走了；最后剩的这一个「线上响应窗口」
 * （`dispatch.bridge_immediate_window_sec`）审计确认**全仓库没有任何地方读它** ——
 * 填了不生效，还有人以为它管着派单节奏，在这儿填半天又找不到原因。
 * 现在整页只留一句话，指到真正生效的「各等级等待时间」。
 */

const DispatchCommissionSettings: React.FC = () => (
  <Card title="🧭 派单优先级">
    <Alert
      type="info"
      showIcon
      message="派单等待时间统一在「各等级等待时间」里改"
      description={
        <span>
          上等马 / 桥接工作室 / 中等马 / 下等马 / 线上俱乐部各等多久看到订单、立即打与预约单多久消失、
          「线上→线下」「线下→线上」流转各留多久，全都在「设置中心 → 各等级等待时间」一处设置。
          <br />
          <Text type="secondary">
            这一页以前那个「线上响应窗口」是历史遗留的无效配置（填了不生效），已删除。
          </Text>
        </span>
      }
    />
    <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
      各段位抢单名额在「评分与名额」里改；分成人 / 桥接单价与返款在「利润分成（分账规则）」里改；
      客服提成与底薪在「客服设置」里改。
    </Text>
  </Card>
);

export default DispatchCommissionSettings;
