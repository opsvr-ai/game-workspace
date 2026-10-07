// craftsman-ignore: TS001,TS002
import React from 'react';
import { Image, Tooltip, Typography } from 'antd';
import {
  CELL_ONE_LINE,
  CELL_SUB_TEXT,
  DATA_SUB_FONT_SIZE,
  FIELD_WIDTH,
} from '../constants/datasetColumns';
import { orderStatusConfig, orderTypeConfig, serviceTypeConfig } from '../constants/orders';
import {
  ORDER_FIELD_LABELS,
  ORDER_DISPATCH_TEXT_COLOR,
  ORDER_DISPATCH_TIP,
  ORDER_STATUS_TEXT_COLOR,
  fieldVisibleTo,
  isOrderStuck,
  orderAmountText,
  orderCustomerWechat,
  orderDispatchTypeLabel,
  orderUrgencyText,
} from '../constants/orderFields';
import { OutcomeSuffix, outcomeSuffixText } from './OrderOutcome';
import { describeTransfer, transferList } from './OrderTransferNote';
import { TEXT, SEMANTIC } from '../styles/tokens';

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
  /**
   * 这一行能不能看客户的来源信息（来源 / 引流账号 / 客户昵称 / 客户账号ID）。
   *
   * 老板 2026-10-02：只有**发单工作室**的管理端能看 —— 客服的订单管理里混着桥接工作室的单，
   * 所以是**逐行**判（页面传 `canSeeCustomerSource(o, user)`）。不传就按老口径：陪玩端不看。
   */
  canSeeSourceFor?: (order: any) => boolean;
  /** 已弃用的来源账号（后面跟灰字「已弃用」） */
  inactiveAccounts?: Set<string>;
  /**
   * 按窗口宽度算出来的列宽（`fitOrderColumnWidths`，键是 FIELD_WIDTH 里的字段名）。
   * 只有订单管理表传这个值 —— 窗口宽的时候「客户账号」这类列要跟着变宽。
   * 不传就按 FIELD_WIDTH 的基准宽度（派单管理那三张列表就是这么用的）。
   */
  widths?: Record<string, number>;
  /**
   * 客服 / 店长点状态格里「成功 / 不成功 / 待反馈」时回调（订单管理 + 派单管理传）。
   * 不传就是只读小字（陪玩端根本不会传这个）。
   */
  onOutcomeClick?: (order: any) => void;
  /** 客服点小字，把「线上→线下流转」的单提前放给本店线下陪玩（订单管理传）。 */
  onReleaseToOffline?: (order: any) => void;
}

export function buildOrderColumns({
  isCompanion,
  canSeeSourceFor,
  inactiveAccounts,
  widths,
  onOutcomeClick,
  onReleaseToOffline,
}: OrderColumnOptions): any[] {
  // 来源那四列逐行判（老板 2026-10-02）：不是发单工作室的行，一个字都不显示
  const sourceHiddenFor = (o: any) => (canSeeSourceFor ? !canSeeSourceFor(o) : false);
  // 列宽统一走这里取：传了 widths（订单管理表）就用算出来的宽度，没传就用基准宽度
  const W = (key: string, fallback: number) => widths?.[key] ?? fallback;
  // 客户来源那几个字段陪玩端看不看得到，口径收在 constants/orderFields.ts 的
  // COMPANION_HIDDEN_FIELDS（老板 2026-09-29「陪玩端 隐藏 客户小红书信息」）——
  // 页面里不再自己判断，表和卡片都调 fieldVisibleTo。
  // 订单管理表的列（老板 2026-09-28：所有信息不要分两层显示、该把字体调小就调小、别花里胡哨）：
  // 历史：17 列（1936px）→ 合并成 9 列上下两行（1182px）→ 一格一行（管理端 1092px）→
  // 2026-09-30 客户信息按发布订单表单的口径拆成五列（管理端 1242px、陪玩端 1024px），
  // 当天随后又按老板要求把状态文案压到 3 个字、状态列 72 → 50 → 46px（管理端基准 1216px、陪玩端 998px）；
  // 状态列同时**不再跟着窗口补宽**（老板 2026-09-30：「状态 跟游戏之间距离太大了 缩小，
  // 跟其他的最小间距一样宽度就可以」—— 46px 正好是 3 个字 + 左右内边距，跟别的列的最小间距一样）。
  // 一个格子只放一行 —— 主信息深色（订单号 / 游戏名 / 金额 / 陪玩名），次要信息 11px 灰字用「·」
  // 跟在后面；长了自动省略号，鼠标停上去看完整内容。状态只用彩色文字、不再用彩色标签块，
  // emoji / 图标全部去掉，行高固定 20px，所以整张表每行一样高（33px）、每列都跟表头一条线。
  // 2026-09-29：管理端「客户账号」列按老板要求加宽到 176px（来源 / 昵称 / 客户账号ID 要看得见）。
  // 2026-09-30：老板「主陪跟发布中间不是有这么大的空间么？你把他们距离缩小，让客户账号全部显示全」，
  // 于是先做了「客户账号 216px + 主陪 84 → 66」；同一天老板又提「你把客户账号拆分成发布订单时
  // 细分的名称不行么？比如来源：小红书 引流账号： 客户昵称 客户账号id 客户联系方式，把前边的微信
  // 挪过去」—— 管理端那一列从此拆成五列（来源 / 引流账号 / 客户昵称 / 客户账号ID / 客户联系方式），
  // 客户微信从「客户微信 / 编号」挪进「客户联系方式」，管理端整表基准 1216px
  // （再靠 fitOrderColumnWidths 按 ORDER_COLUMN_FIT_ORDER 优先补给这五列）。
  // 2026-09-30 晚：老板「从发布订单→进入抢单池/指定→订单管理→客户管理 用的都是同一条数据，
  // 你把所有的显示的标签都用一样的不行么？只是有些数据不展示给陪玩端而已」——
  // 陪玩端不再另写一套「客户微信 / 编号 + 客户账号」，改成**同一份列**按 orderFields.ts 的
  // COMPANION_HIDDEN_FIELDS 少四列（合计 928px，比原来还窄 70px）。
  // 状态的颜色、打单的文案、金额的写法也统一取 constants/orderFields.ts（详情弹窗、卡片同一份）。

    return [

    {
      title: ORDER_FIELD_LABELS.orderCode,
      key: 'orderCode',
      width: W('orderCode', FIELD_WIDTH.orderCode),
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
      title: ORDER_FIELD_LABELS.status,
      key: 'status',
      width: W('orderStatus', FIELD_WIDTH.orderStatus),
      render: (_: unknown, o: any) => {
        const label = orderStatusConfig[o.status]?.label || o.status;
        // 池子里超时没人抢、已退回流转失败明细的单：状态本身看不出来，直接写成红字「无人接」（3 个字）。
        // 判定只有一份（constants/orderFields.ts 的 isOrderStuck）：客服已经接手的单
        // （直添登记 directAdd / 记过添加情况 contactStatus）不算「无人接」，按它自己的状态走
        // —— 老板 2026-10-02：「客服只是记录 又没派单出去，怎么就成了无人接」。
        if (isOrderStuck(o)) {
          return (
            <div style={CELL_ONE_LINE}>
              <Tooltip title="超时没人抢，已从抢单池退回「流转失败明细」：需要重新发布或标记处理完成">
                <span style={{ color: SEMANTIC.dangerMid }}>无人接</span>
              </Tooltip>
            </div>
          );
        }
        // 状态列只有 46px（3 个字），线上 / 桥接单的「· 待反馈」放不下会被省略号吃掉，
        // 所以把结果也拼进 title —— 鼠标停在状态上照样能看到「已被抢 · 待反馈」（老板 2026-09-30）。
        const suffix = isCompanion ? '' : outcomeSuffixText(o);
        return (
          <div style={CELL_ONE_LINE} title={`${label}${suffix}`}>
            <span style={{ color: ORDER_STATUS_TEXT_COLOR[o.status] || TEXT.heading }}>{label}</span>
            {!isCompanion && o.poolScope === 'ONLINE_FIRST' && (
              <span
                style={{
                  color: SEMANTIC.direct,
                  marginLeft: 6,
                  cursor: !o.releasedToOfflineAt && onReleaseToOffline ? 'pointer' : 'default',
                  textDecoration:
                    !o.releasedToOfflineAt && onReleaseToOffline ? 'underline dotted' : undefined,
                }}
                onClick={!o.releasedToOfflineAt && onReleaseToOffline ? () => onReleaseToOffline(o) : undefined}
                title={
                  o.releasedToOfflineAt
                    ? '「线上→线下流转」的单，已经放给本店线下陪玩了'
                    : onReleaseToOffline
                      ? '「线上→线下流转」的单：桥接工作室 + 线上俱乐部秒看到，本店线下陪玩暂时看不见 —— 点这里可以现在就放给线下'
                      : '「线上→线下流转」的单：桥接工作室 + 线上俱乐部秒看到，本店线下陪玩暂时看不见'
                }
              >
                · {o.releasedToOfflineAt ? '已放给线下' : '线上→线下'}
              </span>
            )}
            {/* 线上 / 桥接单的结果（成功 / 不成功 / 待反馈）；线下单不显示 */}
            {!isCompanion && (
              <OutcomeSuffix order={o} onClick={onOutcomeClick ? () => onOutcomeClick(o) : undefined} />
            )}
          </div>
        );
      },
    },
    {
      // 老板 2026-10-07：「怎么看不到订单类型比如指定单」——派单方式是「指定 / 入池」，
      // 和「订单类型」（首单 / 续单 / 复购 / 打赏）是两回事，所以单占一列、紧跟在状态后面。
      // 定宽不参与补宽（和「转让记录」一个道理）：窗口再窄也看得到这张单是不是指定单。
      title: ORDER_FIELD_LABELS.dispatchType,
      key: 'dispatchType',
      width: W('dispatchType', FIELD_WIDTH.dispatchType),
      render: (_: unknown, o: any) => {
        const label = orderDispatchTypeLabel(o);
        // 认不出来的值（老数据 / 新加的枚举）宁可留空，也不把英文原文打到界面上
        if (!label) return <div style={CELL_ONE_LINE} />;
        return (
          <div style={CELL_ONE_LINE} title={ORDER_DISPATCH_TIP[o.dispatchType] || label}>
            <span style={{ color: ORDER_DISPATCH_TEXT_COLOR[o.dispatchType] || TEXT.secondary }}>
              {label}
            </span>
          </div>
        );
      },
    },

    {
      title: ORDER_FIELD_LABELS.game,
      key: 'game',
      width: W('game', FIELD_WIDTH.game),
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
      title: ORDER_FIELD_LABELS.amount,
      key: 'amount',
      width: W('amount', FIELD_WIDTH.amount),
      render: (_: unknown, o: any) => {
        const urgencyText = orderUrgencyText(o);
        const money = orderAmountText(o);
        return (
          <div style={CELL_ONE_LINE} title={`${money} · ${urgencyText}`}>
            <Text strong>{money}</Text>
            <span style={{ ...CELL_SUB_TEXT, color: o.customFields?.urgency === 'later' ? SEMANTIC.infoDeep : TEXT.tertiary }}>
              {urgencyText}
            </span>
          </div>
        );
      },
    },
    // ── 客户信息（五列）──────────────────────────────────────────────────────────
    // 老板 2026-09-30：「从发布订单→进入抢单池/指定→订单管理→客户管理 用的都是同一条数据，
    // 你把所有的显示的标签都用一样的不行么？只是有些数据不展示给陪玩端而已」——
    // 字段名和取值收在 constants/orderFields.ts 一份里（ORDER_FIELD_LABELS / buildOrderFieldEntries），
    // 订单管理表头、订单详情弹窗、抢单池 / 派单工作台那一行、客户管理、客户详情全部调它，
    // 页面里不再各写一套中文标签。
    // 这里一列只放一个字段，按发布订单表单（CreateOrderModal）的口径：
    //   来源（customerSource）· 引流账号（customerSourceAccount）· 客户昵称（customerNickname）
    //   · 客户账号ID（customerAccountId）· 客户联系方式（customerContact = 微信 + YY + KOOK + 房间码）；
    // 客户编号（1~3 位）跟在「客户昵称」后面当小灰字。
    // 陪玩端**只是少几列**（来源 / 引流账号 / 客户昵称 / 客户账号ID 看不到 —— 老板 2026-09-29
    // 「陪玩端 隐藏 客户小红书信息」，见 orderFields.ts 的 COMPANION_HIDDEN_FIELDS），
    // 剩下的「客户联系方式」跟管理端一个字都不差，不再是另写一套写法。
    ...[
      {
        title: ORDER_FIELD_LABELS.customerSource,
        key: 'customerSource',
        width: W('customerSource', FIELD_WIDTH.customerSource),
        render: (_: unknown, o: any) => {
          if (sourceHiddenFor(o)) return <Text type="secondary">-</Text>;
          const platform = o.customFields?.customerSource || o.customer?.platform;
          if (!platform) return <Text type="secondary">-</Text>;
          return (
            <div style={CELL_ONE_LINE} title={platform}>
              {platform}
            </div>
          );
        },
      },
      {
        title: ORDER_FIELD_LABELS.customerSourceAccount,
        key: 'customerSourceAccount',
        width: W('customerSourceAccount', FIELD_WIDTH.customerSourceAccount),
        // 引流账号管理端一律显示完整 —— 老板 2026-09-30「订单管理的引流账号怎么是 *？」，
        // 那条「客服只看自己发的单、别人的抹成 `***`」的规则整条删了（和「客户管理」同口径）；
        // 已弃用的账号后面跟一个小灰字「已弃用」
        render: (_: unknown, o: any) => {
          if (sourceHiddenFor(o)) return <Text type="secondary">-</Text>;
          const account = o.customFields?.customerSourceAccount || '';
          const deprecated = !!account && (inactiveAccounts ?? new Set()).has(account);
          if (!account) return <Text type="secondary">-</Text>;
          return (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}
              title={account + (deprecated ? '（该来源账号已弃用）' : '')}
            >
              <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {account}
              </span>
              {deprecated && (
                <span style={{ flex: '0 0 auto', fontSize: DATA_SUB_FONT_SIZE, color: TEXT.tertiary }}>已弃用</span>
              )}
            </div>
          );
        },
      },
      {
        title: ORDER_FIELD_LABELS.customerNickname,
        key: 'customerNickname',
        width: W('customerNickname', FIELD_WIDTH.customerNickname),
        // 客户编号（1~3 位）单独占一列太浪费，跟在昵称后面当小灰字
        render: (_: unknown, o: any) => {
          if (sourceHiddenFor(o)) return <Text type="secondary">-</Text>;
          const nickname = o.customFields?.customerNickname || '';
          const code = o.customer?.customerCode;
          if (!nickname && !code) return <Text type="secondary">-</Text>;
          return (
            <div
              style={CELL_ONE_LINE}
              title={[nickname || '-', code ? `编号 ${code}` : ''].filter(Boolean).join(' · ')}
            >
              <span>{nickname || '-'}</span>
              {code && <span style={CELL_SUB_TEXT}>· {code}</span>}
            </div>
          );
        },
      },
      {
        title: ORDER_FIELD_LABELS.customerAccountId,
        key: 'customerAccountId',
        width: W('customerAccountId', FIELD_WIDTH.customerAccountId),
        render: (_: unknown, o: any) => {
          if (sourceHiddenFor(o)) return <Text type="secondary">-</Text>;
          const accountId = o.customFields?.customerAccountId || '';
          if (!accountId) return <Text type="secondary">-</Text>;
          return (
            <div style={CELL_ONE_LINE} title={accountId}>
              {accountId}
            </div>
          );
        },
      },
      {
        title: ORDER_FIELD_LABELS.customerContact,
        key: 'customerContact',
        width: W('customerContact', FIELD_WIDTH.customerContact),
        // 微信 + YY + KOOK + 房间码（和发布订单表单「客户联系方式」那一行的四个框一个口径），
        // 二维码小图跟在后面
        render: (_: unknown, o: any) => {
          const cf = o.customFields || {};
          const bits = [
            orderCustomerWechat(o),
            cf.customerYy ? 'YY:' + cf.customerYy : '',
            cf.customerPlatformAccount ? 'KOOK:' + cf.customerPlatformAccount : '',
            cf.customerRoomCode ? '房间' + cf.customerRoomCode : '',
          ].filter(Boolean);
          const qr = cf.customerWechatQr;
          if (!bits.length && !qr) return <Text type="secondary">-</Text>;
          const text = bits.join(' · ');
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }} title={text}>
              <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {bits.map((bit, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span style={{ color: TEXT.disabled }}> · </span>}
                    <span>{bit}</span>
                  </React.Fragment>
                ))}
              </span>
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
    ].filter((col) => fieldVisibleTo(col.key, isCompanion)),
    /* 「备注」：客服发单时填的备注（`customFields.deltaNote`）。
       老板 2026-09-29：「陪玩抢到订单后，订单管理怎么没显示当时发单时填写的备注」——
       客人对局的要求常常就写在这儿；管理端和陪玩端同一列、同一个标签口径。
       列宽用的是陪玩操作列省下来的那 80px（见 datasetColumns.ts 的 ORDER_TABLE_KEYS_COMPANION）。 */
    {
      title: ORDER_FIELD_LABELS.orderNote,
      key: 'orderNote',
      width: W('orderNote', FIELD_WIDTH.orderNote),
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
    {
      title: ORDER_FIELD_LABELS.companion,
      key: 'companion',
      // 管理端用收窄后的 studio（66px，把宽度让给「客户账号」）；陪玩端保持 studioCompanion（84px）
      width: isCompanion ? FIELD_WIDTH.studioCompanion : W('studio', FIELD_WIDTH.studio),
      render: (_: unknown, o: any) => {
        const name = o.companion?.user?.username || '未接单';
        const co = o.coCompanion?.user?.username;
        // 订单上的 studioId 是发布方；两者不一致就是桥接工作室接的单（本店自己的工作室名不用重复写）
        const studio = o.companion?.studio;
        const isBridged = !!o.studioId && !!studio?.id && o.studioId !== studio.id;
        const text = `${name}${co ? '+' + co : ''}${isBridged ? ' · 桥接·' + studio.name : ''}`;
        return (
          <div style={CELL_ONE_LINE} title={text}>
            <span style={{ color: o.companion ? undefined : TEXT.tertiary }}>{name}</span>
            {co && <span style={CELL_SUB_TEXT}>+{co}</span>}
            {isBridged && <span style={{ ...CELL_SUB_TEXT, color: '#6D28D9' }}>· 桥接·{studio.name}</span>}
          </div>
        );
      },
    },
    // 「转让记录」（老板 2026-10-03：「这种转让的能不能放在明面上一眼能看到，还得点订单进去才能看到」）：
    // 以前那个小标记塞在「主陪 / 副陪」格子里（管理端只有 66px），名字 + 副陪一长就被省略号吃掉，
    // 窗口不够宽时那一列还不补宽 —— 等于看不见。现在单独一列、**定宽不参与补宽**，转过的单
    // 一眼就是一个红字「已转让」，鼠标停上去看「什么时候谁转给谁」。
    // 陪玩端不插这一列（接单记录那张表多 64px 会撑出横向滚动；陪玩端转出的那一笔写在
    // 「操作」列，见 OrdersPage 的 showTransferNote）。
    ...(isCompanion
      ? []
      : [
          {
            title: ORDER_FIELD_LABELS.transfers,
            key: 'transfer',
            width: W('transfer', FIELD_WIDTH.transfer),
            render: (_: unknown, o: any) => {
              const list = transferList(o.transfers);
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
                  <div style={CELL_ONE_LINE}>
                    <span style={{ color: SEMANTIC.orangeDeeper, cursor: 'help' }}>
                      已转让{list.length > 1 ? `（${list.length}）` : ''}
                    </span>
                  </div>
                </Tooltip>
              );
            },
          },
        ]),
    {
      title: ORDER_FIELD_LABELS.createdAt,
      key: 'createdAt',
      width: W('createdAt', FIELD_WIDTH.createdAt),
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

/**
 * 客户信息的「标签」列：来源 / 引流账号 / 客户昵称（带编号）/ 客户账号ID / 客户联系方式。
 *
 * 老板 2026-09-30：「管理端直添客户流转明细做的跟订单池流转失败明细+派单工作台一样的标签格式一样，
 * 他们本来就是一样的…他们都是一样的，显示的不一样 显得乱七八糟的」——「客服跟进台账」原来把
 * 编号·微信·昵称·来源·来源账号·账号ID 全挤在一格（用「·」拼），跟订单列表里的五列不是一个样子。
 * 现在它直接复用订单表这几列（同一个函数、同一份列宽），客户信息在哪儿都长一个样，
 * 不会两边各写一份慢慢走样。当天随后老板又说「把客服跟进台账删除，把他的功能合并到管理端直添
 * 客户流转明细」—— 那一页现在就是这份台账，客户信息这几列的来路一个字都没变。
 */
export const CUSTOMER_INFO_COLUMN_KEYS: string[] = [
  'customerSource',
  'customerSourceAccount',
  'customerNickname',
  'customerAccountId',
  'customerContact',
];

export function buildCustomerInfoColumns(options: OrderColumnOptions): any[] {
  return buildOrderColumns(options).filter((c) => CUSTOMER_INFO_COLUMN_KEYS.includes(c.key));
}
