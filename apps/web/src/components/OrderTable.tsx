// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Table, Typography } from 'antd';
import {
  ACTIONS_CELL_CLASS,
  CELL_ONE_LINE,
  FIELD_WIDTH,
  TABLE_STYLE,
} from '../constants/datasetColumns';
import { buildOrderColumns } from './orderColumns';
import { loadInactiveAccounts } from '../utils/inactiveTrafficAccounts';
import { useAuthStore } from '../stores/authStore';

const { Text } = Typography;

/**
 * 派单管理下面几张订单列表（订单池流转失败明细 / 管理端直添客户流转明细 /
 * 线下转桥接·线上统计）共用的表格。
 *
 * 老板 2026-09-28：「流转失败列表页很混乱，你再查查所有角色所有页面 还有同样问题的么 解决」。
 * 以前这三张列表用的是老的卡片行（OrderRow）：一格叠 2~3 行、十几个彩色标签、
 * 按钮自己占一行还左右不对齐，和订单管理完全两个样子。现在统一走这张表：
 *  - 列和订单管理**同宽同序**（订单 / 状态 / 游戏服务 / 金额打单 / 来源 / 引流账号 / 客户昵称 /
 *    客户账号ID / 客户联系方式 / 发布），加一个这一页特有的「说明」列（退回 / 添加 / 收款情况）
 *    和钉在右侧的操作列；
 *  - 一格一行（行高 33px）、超长省略号 + 鼠标悬停看全、状态只用彩色文字不用彩色标签块；
 *  - 表头在正上方，每列内容都从表头那条线开始，四张表上下对齐。
 */
export interface OrderTableProps {
  orders: any[];
  /** 不显示「主陪 / 副陪」列（这三张列表里没人抢的单占多数，主陪信息放进说明列，省下 84px 让表格一屏放得下） */
  hideStudio?: boolean;
  /** 这一页特有的说明列（如「退回情况」）。传 null 就不要这一列 */
  noteColumn?: {
    title: string;
    width?: number;
    render: (o: any) => React.ReactNode;
    /** 鼠标悬停显示的完整内容（列窄，长了就省略号） */
    titleText?: (o: any) => string;
  } | null;
  renderActions?: (o: any) => React.ReactNode;
  loading?: boolean;
  emptyText?: React.ReactNode;
  /** 整行点一下（可选） */
  onRowClick?: (o: any) => void;
  /**
   * 这一页特有的列，插在订单列之后、「说明」列之前。
   *
   * 老板 2026-09-30：「把客服跟进台账删除，把他的功能合并到管理端直添客户流转明细」——
   * 合并后这一页除了订单列 + 收款情况，还要有跟进台账那几列（客服工作微信 / 添加情况 /
   * 最后跟进 / 下次跟进）。列定义还是各页自己写（那是它特有的），
   * 但表格外壳、行高、省略号、表头对齐一律走这张表，跟别的页长一个样。
   */
  extraColumns?: any[];
  /** 操作列的宽度（默认 panelActions；合并后的流转明细按钮多，用订单管理那档 254px） */
  actionsWidth?: number;
  /** 整行样式（「到点该跟进」的行底色标红，见派单管理的流转明细） */
  rowStyle?: (o: any) => React.CSSProperties | undefined;
}

const OrderTable: React.FC<OrderTableProps> = ({
  orders,
  hideStudio,
  noteColumn,
  renderActions,
  loading,
  emptyText = '暂无订单',
  onRowClick,
  extraColumns,
  actionsWidth,
  rowStyle,
}) => {
  const role = useAuthStore((s) => s.user?.role);
  const isCompanion = role === 'COMPANION';
  const [inactiveAccounts, setInactiveAccounts] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    loadInactiveAccounts()
      .then((set) => {
        if (alive) setInactiveAccounts(set);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const columns: any[] = buildOrderColumns({ isCompanion, inactiveAccounts }).filter(
    (c) => !(hideStudio && c.key === 'companion'),
  );
  // 这一页特有的列（跟进台账的「客服工作微信 / 添加情况 / 最后跟进 / 下次跟进」）插在
  // 订单列之后、「说明」列之前：客户信息那几列和别的页一个字都不差，多的只有自己这几列。
  if (extraColumns && extraColumns.length > 0) {
    columns.push(...extraColumns);
  }
  if (noteColumn) {
    columns.push({
      title: noteColumn.title,
      key: 'panelNote',
      width: noteColumn.width ?? FIELD_WIDTH.panelNote,
      render: (_: unknown, o: any) => (
        <div style={CELL_ONE_LINE} title={noteColumn.titleText ? noteColumn.titleText(o) : undefined}>
          {noteColumn.render(o)}
        </div>
      ),
    });
  }
  if (renderActions) {
    columns.push({
      title: '操作',
      key: 'actions',
      width: actionsWidth ?? FIELD_WIDTH.panelActions,
      fixed: 'right' as const,
      className: ACTIONS_CELL_CLASS,
      render: (_: unknown, o: any) => renderActions(o),
    });
  }

  // scroll.x 按实际列宽之和算：写小了 antd 会把列按比例压扁（昵称那类列会被挤成竖排单字）
  const scrollX = columns.reduce((total, c) => total + (Number(c.width) || 0), 0);

  return (
    <Table
      className="data-table"
      rowKey="id"
      columns={columns}
      dataSource={orders}
      size="small"
      loading={loading}
      pagination={false}
      style={TABLE_STYLE}
      scroll={{ x: scrollX }}
      locale={{ emptyText }}
      onRow={(record: any) => {
        const extra = rowStyle ? rowStyle(record) : undefined;
        if (!onRowClick && !extra) return {};
        return {
          style: { ...(onRowClick ? { cursor: 'pointer' as const } : {}), ...(extra || {}) },
          ...(onRowClick ? { onClick: () => onRowClick(record) } : {}),
        };
      }}
    />
  );
};

/** 说明列里的次要信息（灰色小字） */
export const noteSub: React.CSSProperties = { fontSize: 11, color: '#94A3B8' };
/** 说明列里的分隔符 */
export const NOTE_SEP = ' · ';

export default OrderTable;
