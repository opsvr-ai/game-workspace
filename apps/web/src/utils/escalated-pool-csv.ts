/**
 * 「线下转桥接/线上统计」导出用的 CSV 拼装（老板 2026-09-29）。
 *
 * 单独放出来是为了「一键导出全员（一人一张）」能跟界面上那份**用同一段代码**拼，
 * 也算钱口径只写一份（后端算好 → 这里只排版）。
 * 文件带 BOM + CRLF，Excel 双击直接打开。
 */
import dayjs from 'dayjs';

/** CSV 单元格：带逗号 / 引号 / 换行就整体加引号。 */
export const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 结果标签（表格和 CSV 共用一份，避免两处口径不一致）。 */
export const STATE_MAP: Record<string, { text: string; color: string }> = {
  SUCCESS: { text: '成功', color: '#15803D' },
  FAILED: { text: '不成功', color: '#DC2626' },
  PENDING: { text: '待反馈', color: '#B45309' },
  NONE: { text: '已退款/取消', color: '#94A3B8' },
};

/** 文件名里不能出现的字符（客服名理论上不会有，但也兜一下）。 */
export const safeFileName = (s: string): string =>
  (s || '').replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名';

export const DETAIL_HEADER = [
  '时间',
  '客户',
  '客服',
  '游戏',
  '机密/绝密',
  '单/双',
  '被谁接走',
  '去向工作室',
  '结算模式',
  '单量',
  '应收(元)',
  '应返还(元)',
  '工作室净得(元)',
  '钱在哪里',
  '已记流入(元)',
  '已记流出(元)',
  '结果',
  '备注',
];

const yuan2 = (n: unknown): string => Number(n || 0).toFixed(2);

/**
 * 一份数据的 CSV：开头几行是**汇总**（被接走单数 / 单量 / 应收 / 应返还 / 工作室净得 / 已记流入·流出），
 * 空一行后是**逐单明细**。
 *
 * @param month 统计月份 `YYYY-MM`
 * @param scope 这份数据是谁名下的（客服名，或「全部客服」）
 * @param data  后端 `GET /orders/escalated-pool` 返回的 `{ rows, totals }`
 */
export function buildEscalatedPoolCsv(
  month: string,
  scope: string,
  data: { rows?: any[]; totals?: any },
): string {
  const rows = data?.rows || [];
  const t = data?.totals || {};
  const lines: string[] = [];
  lines.push([csvCell('线下转桥接/线上统计'), csvCell(month), csvCell(scope)].join(','));
  lines.push(
    [
      csvCell('被接走(单)'),
      csvCell(t.count || 0),
      csvCell(`桥接 ${t.bridgeCount || 0} / 线上 ${t.onlineCount || 0}`),
      csvCell(`单量 ${t.units || 0}（机密 ${t.jimiUnits || 0} / 绝密 ${t.juejuUnits || 0}）`),
    ].join(','),
  );
  lines.push(
    [
      csvCell('应收合计(元)'),
      csvCell(yuan2(t.grossYuan)),
      csvCell(`桥接 ${yuan2(t.bridgeGrossYuan)}`),
      csvCell(`线上 ${yuan2(t.onlineGrossYuan)}`),
    ].join(','),
  );
  lines.push(
    [
      csvCell('应返还合计(元)'),
      csvCell(yuan2(t.returnYuan)),
      csvCell(`桥接 ${yuan2(t.bridgeReturnYuan)}`),
      csvCell(`线上 ${yuan2(t.onlineReturnYuan)}`),
    ].join(','),
  );
  lines.push(
    [
      csvCell('工作室净得合计(元)'),
      csvCell(yuan2(t.studioNetYuan)),
      csvCell(`已记流入 ${yuan2(t.moneyInYuan)}`),
      csvCell(`已记流出 ${yuan2(t.moneyOutYuan)}`),
    ].join(','),
  );
  lines.push('');
  lines.push(DETAIL_HEADER.map(csvCell).join(','));
  rows.forEach((r: any) => {
    lines.push(
      [
        r.createdAt ? dayjs(r.createdAt).format('YYYY-MM-DD HH:mm') : '',
        r.customerCode || r.customerWechat || '',
        r.csName || '',
        r.gameName || '',
        r.mission || '',
        r.countText || '',
        r.destination || '',
        r.destinationStudioName || '',
        r.settleMode || '',
        r.units ?? '',
        yuan2(r.grossYuan),
        yuan2(r.returnYuan),
        yuan2(r.studioNetYuan),
        (r.moneyWhere || []).join(' / '),
        yuan2(r.moneyInYuan),
        yuan2(r.moneyOutYuan),
        STATE_MAP[r.state]?.text || r.state || '',
        r.stateReason || '',
      ]
        .map(csvCell)
        .join(','),
    );
  });
  return lines.join('\r\n');
}
