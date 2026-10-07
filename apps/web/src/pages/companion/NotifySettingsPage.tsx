// craftsman-ignore: TS001,TS002
import React from 'react';
import { Card } from 'antd';
import PageHeader from '../../components/PageHeader';
import OrderNotifySettingsPanel from '../../components/OrderNotifySettingsPanel';

/**
 * 陪玩端「设置 → 通知设置」页（老板 2026-10-08 报王甲振那台之后加的）。
 *
 * 老板原话：「刚才看了王甲振电脑，他设置里没有关弹窗的地方，并且没弹窗」。
 * 以前陪玩的「设置」菜单下只有「个人设置」，弹窗开关只挂在首页卡片右上角一颗没字的 🔔 上 ——
 * 从菜单进「设置」永远找不到。现在把同一份面板（components/OrderNotifySettingsPanel.tsx）
 * 也挂到菜单里，跟首页 🔔 弹窗共用同一个组件，改一处两边都变。
 */
const NotifySettingsPage: React.FC = () => (
  <>
    <PageHeader
      title="通知设置"
      subtitle="新单弹窗在哪些状态下弹给你：空闲 / 挂机（休息）一律弹；接单中 / 娱乐中按这里自己开关"
    />
    <Card size="small">
      <OrderNotifySettingsPanel />
    </Card>
  </>
);

export default NotifySettingsPage;
