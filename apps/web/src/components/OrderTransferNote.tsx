import React from 'react';
import { Tooltip } from 'antd';
import { CELL_SUB_TEXT, DATA_SUB_FONT_SIZE } from '../constants/datasetColumns';

/**
 * 订单转让留痕的展示件（老板 2026-09-29）。
 *
 * 「抢单超时自动回收」整条删除后，换手只剩「陪玩自己点转让」这一条路。转让必须留痕：
 * 转出方的接单记录里这张单不能消失，还要写清「什么时候转让给了谁」。订单管理 /
 * 接单记录 / 客户管理三处共用这里的两个展示件，保证口径一致。
 */
export interface TransferLike {
  id?: string;
  createdAt?: string | null;
  reason?: string | null;
  fromCompanion?: { user?: { username?: string | null; displayName?: string | null } | null } | null;
  toCompanion?: { user?: { username?: string | null; displayName?: string | null } | null } | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 转让时间短格式：2026-09-29 23:10 */
export function formatTransferTime(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 转让留痕上的陪玩名（没填昵称就用登录名） */
export const transferWho = (c?: TransferLike['fromCompanion']): string =>
  c?.user?.displayName || c?.user?.username || '未知陪玩';

/** 一句话转让说明：「2026-09-29 23:10 秦伟杰 转让给 陈佳祺 · 原因：客户一直没通过」 */
export function describeTransfer(t: TransferLike): string {
  const head = `${formatTransferTime(t.createdAt)} ${transferWho(t.fromCompanion)} 转让给 ${transferWho(t.toCompanion)}`;
  return t.reason ? `${head} · 原因：${t.reason}` : head;
}

export function transferList(transfers?: TransferLike[] | null): TransferLike[] {
  return Array.isArray(transfers) ? transfers : [];
}

/**
 * 列表行里的转让小标记：字面只写「已转让」（多次转让带笔数），是谁什么时候转给谁
 * 放在悬停里 —— 订单表每一列都是定宽，长句会把整张表撑歪。
 */
export const TransferMark: React.FC<{ transfers?: TransferLike[] | null }> = ({ transfers }) => {
  const list = transferList(transfers);
  if (list.length === 0) return null;
  return (
    <Tooltip
      title={
        <div>
          {list.map((t, i) => (
            <div key={t.id || i}>{describeTransfer(t)}</div>
          ))}
        </div>
      }
    >
      <span style={{ ...CELL_SUB_TEXT, color: '#C2410C', cursor: 'help' }}>
        · 已转让{list.length > 1 ? `（${list.length}）` : ''}
      </span>
    </Tooltip>
  );
};

/** 整句转让说明：订单详情 / 客户管理里空间够，直接把「什么时候转让给谁」写全。 */
export const TransferNote: React.FC<{ transfers?: TransferLike[] | null }> = ({ transfers }) => {
  const list = transferList(transfers);
  if (list.length === 0) return null;
  return (
    <div style={{ fontSize: DATA_SUB_FONT_SIZE }}>
      {list.map((t, i) => (
        <div key={t.id || i} style={{ color: '#C2410C' }}>
          已转让：{describeTransfer(t)}
        </div>
      ))}
    </div>
  );
};
