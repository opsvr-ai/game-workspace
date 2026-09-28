// craftsman-ignore: TS001,TS002
import React from 'react';
import { Image, Tooltip, Typography } from 'antd';
import {
  canSeeCustomerSource,
  CELL_ONE_LINE,
  CELL_SUB_TEXT,
  FIELD_WIDTH,
} from '../constants/datasetColumns';
import { orderStatusConfig, orderTypeConfig, serviceTypeConfig } from '../constants/orders';

const { Text } = Typography;

/**
 * 订单表格的列（订单管理 + 派单管理下面的三张订单列表共用这一份）。
 *
 * 老板 2026-09-28：「所有信息不要分两层显示，该把字体调小就调小，而且显示的感觉花里胡哨 很乱」、
 * 「流转失败列表页很混乱」 —— 以前「订单池流转失败明细 / 跟进列表 / 流转明细」这三张列表用的是
 * 老的卡片行（一格叠 2~3 行、十几个彩色标签、按钮单独占一行），和订单管理完全两个样子。
 * 现在把订单管理的 8 列抽到这里，谁要展示订单谁就调这一份，样式永远一致：
 * **一格一行**（主信息深色 + 11px 灰字跟在后面）、列宽取 FIELD_WIDTH、
 * 状态只用彩色文字（不再彩色标签块）、超长自动省略号 + 鼠标悬停看全。
 */
export interface OrderColumnOptions {
  /** 陪玩视角：客户昵称 / 来源账号 / 客户ID 不展示（和订单池口径一致） */
  isCompanion: boolean;
  /** 已弃用的来源账号（后面跟灰字「已弃用」） */
  inactiveAccounts?: Set<string>;
}

export function buildOrderColumns({ isCompanion, inactiveAccounts }: OrderColumnOptions): any[] {
  // 订单管理表的列（老板 2026-09-28：所有信息不要分两层显示、该把字体调小就调小、别花里胡哨）：
  // 历史：17 列（1936px）→ 合并成 9 列上下两行（1182px）→ 现在**一格一行**（管理端 1072px、陪玩端 984px）。
  // 一个格子只放一行 —— 主信息深色（订单号 / 游戏名 / 金额 / 陪玩名），次要信息 11px 灰字用「·」
  // 跟在后面；长了自动省略号，鼠标停上去看完整内容。状态只用彩色文字、不再用彩色标签块，
  // emoji / 图标全部去掉，行高固定 20px，所以整张表每行一样高（33px）、每列都跟表头一条线。
  // 2026-09-29：管理端「客户账号」列按老板要求加宽到 176px（来源 / 昵称 / 客户账号ID 要看得见），
  // 管理端整表 1072px —— 1320 宽的窗口会有约 80px 横向滚动，这是这一列显示全的代价。
  // 陪玩端那套列用窄版（84px），合计仍然是 984px，陪玩端窗口不会多出滚动条。
  const STATUS_TEXT_COLOR: Record<string, string> = {
    PENDING: '#B45309',
    CLAIMED: '#6D28D9',
    GRABBED: '#1D4ED8',
    CONFIRMED: '#15803D',
    DONE: '#15803D',
    CANCELLED: '#94A3B8',
  };
  // 「打单」不再用彩色标签：立即打是灰字，预约是蓝字（等时间的单要一眼看出来）
  const URGENCY_TEXT: Record<string, string> = { now: '立即打', later: '预约' };

    return [

    {
      title: '订单',
      key: 'orderCode',
      width: FIELD_WIDTH.orderCode,
      render: (_: unknown, o: any) => {
        const code = o.orderCode || o.id.slice(0, 8);
        const typeLabel = orderTypeConfig[o.type]?.label || o.type || '首单';
        return (
          <div style={CELL_ONE_LINE} title={`${code} · ${typeLabel}`}>
            <Text strong>{code}</Text>
            <span style={CELL_SUB_TEXT}>· {typeLabel}</span>
          </div>
        );
      },
    },
    {
      title: '状态',
      key: 'status',
      width: FIELD_WIDTH.orderStatus,
      render: (_: unknown, o: any) => {
        const label = orderStatusConfig[o.status]?.label || o.status;
        // 池子里超时没人抢、已退回流转失败明细的单：状态本身看不出来，直接写成红字「无人接单」
        const stuck = o.customFields?.poolExpired === true && !o.companionId;
        if (stuck) {
          return (
            <div style={CELL_ONE_LINE}>
              <Tooltip title="超时没人抢，已从抢单池退回「流转失败明细」：需要重新发布或标记处理完成">
                <span style={{ color: '#DC2626' }}>无人接单</span>
              </Tooltip>
            </div>
          );
        }
        return (
          <div style={CELL_ONE_LINE} title={label}>
            <span style={{ color: STATUS_TEXT_COLOR[o.status] || '#475569' }}>{label}</span>
          </div>
        );
      },
    },
    {
      title: '游戏 / 服务',
      key: 'game',
      width: FIELD_WIDTH.game,
      render: (_: unknown, o: any) => {
        const cf = o.customFields || {};
        const svc = serviceTypeConfig[o.serviceType]?.label;
        const parts = [
          // 默认服务就是「陪玩」，只在护航 / 做任务时写出来，把宽度留给游戏名和机密 / 绝密
          svc && svc !== '陪玩' ? svc : '',
          cf.deltaMission || '',
          cf.deltaCount === '双' ? '双' : '',
        ].filter(Boolean);
        const text = `${o.gameName}${parts.length ? ' ' + parts.join(' ') : ''}`;
        return (
          <div style={CELL_ONE_LINE} title={text}>
            <Text strong>{o.gameName}</Text>
            {parts.length > 0 && <span style={CELL_SUB_TEXT}>{parts.join(' ')}</span>}
          </div>
        );
      },
    },
    {
      title: '金额 / 打单',
      key: 'amount',
      width: FIELD_WIDTH.amount,
      render: (_: unknown, o: any) => {
        const urgency = o.customFields?.urgency === 'later' ? 'later' : 'now';
        const money = `¥${Number(o.amount).toFixed(0)}`;
        return (
          <div style={CELL_ONE_LINE} title={`${money} · ${URGENCY_TEXT[urgency]}`}>
            <Text strong>{money}</Text>
            <span style={{ ...CELL_SUB_TEXT, color: urgency === 'later' ? '#1D4ED8' : '#94A3B8' }}>
              {URGENCY_TEXT[urgency]}
            </span>
          </div>
        );
      },
    },
    {
      title: '客户微信 / 编号',
      key: 'customerWechat',
      width: FIELD_WIDTH.customerWechat,
      render: (_: unknown, o: any) => {
        const code = o.customer?.customerCode;
        const wechat = o.customFields?.customerWechat || o.customer?.wechatId || '-';
        return (
          <div style={CELL_ONE_LINE} title={code ? `${wechat} · 编号 ${code}` : wechat}>
            <span>{wechat}</span>
            {code && <span style={CELL_SUB_TEXT}>· {code}</span>}
          </div>
        );
      },
    },
    {
      title: '客户账号',
      key: 'customerAccounts',
      // 管理端 176px（来源 / 昵称 / 客户账号ID 都要看得见）、陪玩端 84px（只有房间码 / YY / KOOK）
      width: isCompanion ? FIELD_WIDTH.customerAccountsCompanion : FIELD_WIDTH.customerAccounts,
      // 这一列的字段原样搬自「派单工作台 → 派单记录」的订单行：客服核单时一眼认出是哪个客户。
      // 客户ID / 昵称对陪玩不展示（和订单池的行口径一致）。
      // 来源平台（「小红书」三个字）和来源账号一起对陪玩藏掉 —— 老板 2026-09-29：
      // 「陪玩端 隐藏 客户小红书信息」。房间码 / YY / KOOK 是陪玩自己找人对局要用的，照常显示。
      // 原来是一格 5~6 行（来源、昵称、房间码、YY/KOOK、二维码），现在压成一行，长了自己省略号。
      // 管理端这一列 176px（FIELD_WIDTH.customerAccounts）：来源 / 昵称 / 账号ID 一眼看全，
      // 陪玩端只有 84px 的窄版（FIELD_WIDTH.customerAccountsCompanion）。
      render: (_: unknown, o: any) => {
        const cf = o.customFields || {};
        const showSource = canSeeCustomerSource(isCompanion ? 'COMPANION' : 'CS');
        const platform = showSource ? cf.customerSource || o.customer?.platform : '';
        const deprecated = !isCompanion && !!cf.customerSourceAccount && (inactiveAccounts ?? new Set()).has(cf.customerSourceAccount);
        const bits = [
          platform ? platform + (cf.customerSourceAccount ? ' ' + cf.customerSourceAccount : '') : '',
          !isCompanion && cf.customerNickname ? cf.customerNickname : '',
          !isCompanion && cf.customerAccountId ? cf.customerAccountId : '',
          cf.customerRoomCode ? '房间' + cf.customerRoomCode : '',
          cf.customerYy ? 'YY:' + cf.customerYy : '',
          cf.customerPlatformAccount ? 'KOOK:' + cf.customerPlatformAccount : '',
        ].filter(Boolean);
        // 段与段之间只留一个小灰点。老版是「 · 」（点两边各一个空格），三四个点就白吃掉 20~30px ——
        // 老板 2026-09-29：「把标签之间的间距压缩一下，现在左右标签之间距离太大了」。
        const text = bits.join('·');
        const qr = cf.customerWechatQr;
        if (!bits.length && !qr) return '-';
        return (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}
            title={text + (deprecated ? '（该来源账号已弃用）' : '')}
          >
            {/* 宽度按内容走（flex: 0 1 auto）：二维码 / 已弃用 紧跟在文字后面，
                不再被 flex 撑到列的另一头去。 */}
            <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {bits.length ? (
                bits.map((bit, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span style={{ color: '#CBD5E1' }}>·</span>}
                    <span>{bit}</span>
                  </React.Fragment>
                ))
              ) : (
                '-'
              )}
            </span>
            {deprecated && (
              <span style={{ flex: '0 0 auto', fontSize: 11, color: '#94A3B8' }}>已弃用</span>
            )}
            {qr && (
              <Image
                src={qr}
                width={16}
                height={16}
                style={{ flex: '0 0 auto', borderRadius: 2, objectFit: 'cover' }}
                preview={{ mask: '二维码' }}
              />
            )}
          </div>
        );
      },
    },
    /* 陪玩端在「客户账号」后面多一列「备注」：客服发单时填的备注（`customFields.deltaNote`）。
       以前只有订单池卡片和订单详情弹窗里有，抢完单进了接单记录就看不到了 ——
       老板 2026-09-29：「陪玩抢到订单后，订单管理怎么没显示当时发单时填写的备注」。
       客人对局的要求常常就写在这儿，陪玩必须一眼看得到。列宽用的是陪玩操作列省下来的那 80px
       （见 datasetColumns.ts 的 ORDER_TABLE_KEYS_COMPANION），整张表仍落在 1320 窗口的 985px 里。 */
    ...(isCompanion
      ? [
          {
            title: '备注',
            key: 'orderNote',
            width: FIELD_WIDTH.orderNote,
            render: (_: unknown, o: any) => {
              const note = o.customFields?.deltaNote || o.notes || '';
              if (!note) return <Text type="secondary">-</Text>;
              return (
                <div style={CELL_ONE_LINE} title={note}>
                  {note}
                </div>
              );
            },
          },
        ]
      : []),
    {
      title: '主陪 / 副陪',
      key: 'companion',
      width: FIELD_WIDTH.studio,
      render: (_: unknown, o: any) => {
        const name = o.companion?.user?.username || '未接单';
        const co = o.coCompanion?.user?.username;
        // 订单上的 studioId 是发布方；两者不一致就是桥接工作室接的单（本店自己的工作室名不用重复写）
        const studio = o.companion?.studio;
        const isBridged = !!o.studioId && !!studio?.id && o.studioId !== studio.id;
        const text = `${name}${co ? '+' + co : ''}${isBridged ? ' · 桥接·' + studio.name : ''}`;
        return (
          <div style={CELL_ONE_LINE} title={text}>
            <span style={{ color: o.companion ? undefined : '#94A3B8' }}>{name}</span>
            {co && <span style={CELL_SUB_TEXT}>+{co}</span>}
            {isBridged && <span style={{ ...CELL_SUB_TEXT, color: '#6D28D9' }}>· 桥接·{studio.name}</span>}
          </div>
        );
      },
    },
    {
      title: '发布',
      key: 'createdAt',
      width: FIELD_WIDTH.createdAt,
      // 发布人 + 发布时间一行。时间只写「09-27 01:11」——原来「2026/9/27 01:11:46」要 100px 以上，
      // 完整时间（含年份）悬停看。
      render: (_: unknown, o: any) => {
        const d = new Date(o.grabbedAt || o.createdAt);
        const pad = (n: number) => String(n).padStart(2, '0');
        const short = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        const who = o.csUser?.username || '-';
        return (
          <div style={CELL_ONE_LINE} title={`${who} · ${d.toLocaleString('zh-CN', { hour12: false })}`}>
            <span>{who}</span>
            <span style={CELL_SUB_TEXT}>{short}</span>
          </div>
        );
      },
    },
  ];
}
