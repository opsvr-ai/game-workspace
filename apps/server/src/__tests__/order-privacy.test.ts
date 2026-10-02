import { describe, it, expect } from 'vitest';
import {
  canSeeCustomerSource,
  maskCustomerWechat,
  stripCustomerSource,
  stripCustomerSourceDeep,
  stripCustomerSourceForViewer,
} from '../common/order-privacy';

/**
 * 客户来源（来源平台 / 引流账号 / 客户昵称 / 客户账号ID）的可见性：
 *
 *  - 2026-09-28：按「客服只显示自己发的单」把引流账号抹成 `***`（`canSeeSourceAccount`）；
 *  - 2026-09-30：老板「管理端的 订单管理 引流账号 怎么是 *？」+「所有页面显示一致」→
 *    抹号那条整条删掉，只剩「陪玩端看不到」；
 *  - 2026-10-02：老板发现**桥接工作室的店长 / 客服**也能看到别家客户的来源 → 改成按
 *    **发单工作室**判（见下面 `canSeeCustomerSource` / `stripCustomerSourceForViewer`）。
 */

describe('maskCustomerWechat（客户微信可见性，口径不变）', () => {
  const withWechat = {
    companionId: 'cpMain',
    coCompanionId: 'cpCo',
    customer: { wechatId: 'wx123' },
    customFields: { customerWechat: 'wx123', customerWechatQr: 'qr.png' },
  };

  it('客服 / 店长 / 老板：原样返回', () => {
    for (const role of ['CS', 'ADMIN', 'OWNER']) {
      const out = maskCustomerWechat({ ...withWechat }, { id: 'u', role });
      expect(out.customer.wechatId).toBe('wx123');
      expect(out.customFields.customerWechat).toBe('wx123');
    }
  });

  it('主陪：原样返回', () => {
    const out = maskCustomerWechat({ ...withWechat }, { id: 'u', role: 'COMPANION', companionId: 'cpMain' });
    expect(out.customFields.customerWechat).toBe('wx123');
  });

  it('副陪（搭档）：客户微信与二维码都清掉', () => {
    const out = maskCustomerWechat({ ...withWechat }, { id: 'u', role: 'COMPANION', companionId: 'cpCo' });
    expect(out.customer.wechatId).toBe('');
    expect(out.customFields.customerWechat).toBe('');
    expect(out.customFields.customerWechatQr).toBeUndefined();
  });
});

/**
 * 客户来源（来源平台 / 引流账号 / 客户昵称 / 客户账号ID）可见性 —— 老板 2026-10-02：
 * 「蠢驴电竞的客服孙可馨发单，为什么桥接工作室的黄浩那边没抢单就能显示客户的小红书信息？
 * ……除了发单工作室的管理端能看到其他人一律看不到」。
 *
 * 口径：**只有发单工作室**（数据自己的 `studioId`）的客服 / 店长 / 老板能看到；
 * 全站老板（不挂工作室）看全部；接单方一律看不到（桥接工作室的店长 / 客服、别的店、所有陪玩）。
 *
 * 沿革：2026-09-29 只按角色判（「不是陪玩就能看」），所以才漏给了桥接工作室的管理端。
 */
describe('canSeeCustomerSource（客户来源可见性：按发单工作室判）', () => {
  const csA = { id: 'cs-a', role: 'CS', studioId: 'studio-a' };
  const adminA = { id: 'admin-a', role: 'ADMIN', studioId: 'studio-a' };
  const csB = { id: 'cs-b', role: 'CS', studioId: 'studio-b' };
  const adminB = { id: 'admin-b', role: 'ADMIN', studioId: 'studio-b' };
  const owner = { id: 'owner', role: 'OWNER', studioId: null };
  const companionA = { id: 'cp-user-a', role: 'COMPANION', studioId: 'studio-a', companionId: 'cp1' };

  it('发单工作室的客服 / 店长 / 老板：看得到', () => {
    expect(canSeeCustomerSource(csA, 'studio-a')).toBe(true);
    expect(canSeeCustomerSource(adminA, 'studio-a')).toBe(true);
    expect(canSeeCustomerSource({ ...owner, studioId: 'studio-a' }, 'studio-a')).toBe(true);
    // 传对象也行（订单 / 客户档案本身）
    expect(canSeeCustomerSource(csA, { studioId: 'studio-a' })).toBe(true);
  });

  it('接单工作室（桥接店）的客服 / 店长：看不到 —— 老板 2026-10-02 报的就是这个', () => {
    expect(canSeeCustomerSource(adminB, 'studio-a')).toBe(false);
    expect(canSeeCustomerSource(csB, 'studio-a')).toBe(false);
  });

  it('陪玩：本店的单也看不到（陪玩端这条线一直没放开过）', () => {
    expect(canSeeCustomerSource(companionA, 'studio-a')).toBe(false);
  });

  it('全站老板（不挂工作室）：所有工作室都能看；挂了工作室的老板只看自家', () => {
    expect(canSeeCustomerSource(owner, 'studio-a')).toBe(true);
    expect(canSeeCustomerSource(owner, 'studio-b')).toBe(true);
    expect(canSeeCustomerSource({ ...owner, studioId: 'studio-a' }, 'studio-b')).toBe(false);
  });

  it('没有登录用户 / 拿不到归属：一律不给看（从严）', () => {
    expect(canSeeCustomerSource(null, 'studio-a')).toBe(false);
    expect(canSeeCustomerSource(undefined, 'studio-a')).toBe(false);
    expect(canSeeCustomerSource(csA, undefined)).toBe(false);
    expect(canSeeCustomerSource(csA, '')).toBe(false);
  });
});

/**
 * 管理端接口响应用的 `stripCustomerSourceForViewer`：**逐条**按数据自己的归属工作室判，
 * 所以「客服的订单管理 / 抢单池里混着自家和桥接工作室的单」这种情况也是对的。
 */
describe('stripCustomerSourceForViewer（按工作室逐条清理）', () => {
  const orderOf = (studioId: string) => ({
    id: `o-${studioId}`,
    studioId,
    customFields: {
      customerSource: '小红书',
      customerSourceAccount: 'ok绷',
      customerNickname: '小美',
      customerAccountId: 'xhs_123',
      customerWechat: 'wx1',
      customerRoomCode: '8888',
    },
    customer: { customerCode: 'C001', platform: '小红书', wechatId: 'wx1' },
  });

  it('发单工作室的客服：自家的单原样，桥接工作室的单摘干净（联系方式留着）', () => {
    const payload = { code: 200, message: 'ok', data: [orderOf('studio-a'), orderOf('studio-b')] };
    const out: any = stripCustomerSourceForViewer(payload, {
      id: 'cs-a',
      role: 'CS',
      studioId: 'studio-a',
    });

    // 自家单：一个字都不动
    expect(out.data[0].customFields.customerSource).toBe('小红书');
    expect(out.data[0].customFields.customerNickname).toBe('小美');
    expect(out.data[0].customer.platform).toBe('小红书');

    // 别家的单：来源四件套全没了
    expect(out.data[1].customFields).not.toHaveProperty('customerSource');
    expect(out.data[1].customFields).not.toHaveProperty('customerSourceAccount');
    expect(out.data[1].customFields).not.toHaveProperty('customerNickname');
    expect(out.data[1].customFields).not.toHaveProperty('customerAccountId');
    expect(out.data[1].customer.platform).toBe('');

    // 接单方要用的微信 / 房间码 / 客户编号：留着
    expect(out.data[1].customFields.customerWechat).toBe('wx1');
    expect(out.data[1].customFields.customerRoomCode).toBe('8888');
    expect(out.data[1].customer.wechatId).toBe('wx1');
    expect(out.data[1].customer.customerCode).toBe('C001');

    // 原对象不动（推送时还要用原对象）
    expect(payload.data[1].customFields.customerSource).toBe('小红书');
  });

  it('桥接工作室的店长 / 客服：一条都看不到（老板 2026-10-02 报的那个洞）', () => {
    const payload = { data: [orderOf('studio-a')] };
    const out: any = stripCustomerSourceForViewer(payload, {
      id: 'admin-b',
      role: 'ADMIN',
      studioId: 'studio-b',
    });
    expect(out.data[0].customFields).not.toHaveProperty('customerSource');
    expect(out.data[0].customFields).not.toHaveProperty('customerSourceAccount');
    expect(out.data[0].customFields).not.toHaveProperty('customerNickname');
    expect(out.data[0].customFields).not.toHaveProperty('customerAccountId');
    expect(out.data[0].customer.platform).toBe('');
  });

  it('陪玩：自己的单也看不到来源', () => {
    const out: any = stripCustomerSourceForViewer({ data: [orderOf('studio-a')] }, {
      id: 'cp-user',
      role: 'COMPANION',
      studioId: 'studio-a',
      companionId: 'cp1',
    });
    expect(out.data[0].customFields).not.toHaveProperty('customerSource');
  });

  it('全站老板（不挂工作室）：一条都不动', () => {
    const payload = { data: [orderOf('studio-a'), orderOf('studio-b')] };
    const out: any = stripCustomerSourceForViewer(payload, { id: 'owner', role: 'OWNER', studioId: null });
    expect(out.data[0].customFields.customerSource).toBe('小红书');
    expect(out.data[1].customFields.customerSource).toBe('小红书');
    expect(out).toStrictEqual(payload);
    // 原对象一个字都没被改
    expect(payload.data[1].customFields.customerNickname).toBe('小美');
  });

  it('订单里嵌的 customer（自己没有 studioId）：跟外层结论走', () => {
    const out: any = stripCustomerSourceForViewer({ data: [orderOf('studio-b')] }, {
      id: 'cs-a',
      role: 'CS',
      studioId: 'studio-a',
    });
    expect(out.data[0].customer.platform).toBe('');
    expect(out.data[0].customer.wechatId).toBe('wx1');
  });

  it('包一层的 { code, data }、数组、null 都能安全过一遍', () => {
    expect(stripCustomerSourceForViewer(null, { id: 'cs-a', role: 'CS', studioId: 'studio-a' })).toBe(null);
    const out: any = stripCustomerSourceForViewer(
      { code: 200, data: [null, { id: 's1', type: 'DUAL_INVITE' }] },
      { id: 'cs-a', role: 'CS', studioId: 'studio-a' },
    );
    expect(out.data[1].type).toBe('DUAL_INVITE');
  });
});

describe('stripCustomerSource（把来源从订单里摘掉）', () => {
  const fullOrder = () => ({
    id: 'o1',
    gameName: '三角洲行动',
    customer: { customerCode: 'C001', platform: '小红书', wechatId: 'wx1' },
    customFields: {
      customerSource: '小红书',
      customerSourceAccount: 'ok绷',
      customerNickname: '小美',
      customerAccountId: 'xhs_123',
      customerWechat: 'wx1',
      customerRoomCode: '8888',
    },
  });

  it('来源四件套（来源 / 引流账号 / 客户昵称 / 客户账号ID）直接删键，接单方要用的联系方式原样留着', () => {
    const out: any = stripCustomerSource(fullOrder());
    expect(out.customFields).not.toHaveProperty('customerSource');
    expect(out.customFields).not.toHaveProperty('customerSourceAccount');
    expect(out.customFields).not.toHaveProperty('customerNickname');
    expect(out.customFields).not.toHaveProperty('customerAccountId');
    expect(out.customFields.customerWechat).toBe('wx1');
    expect(out.customFields.customerRoomCode).toBe('8888');
  });

  it('customer.platform 也清空（老单那一格的兜底就是它）', () => {
    const out: any = stripCustomerSource(fullOrder());
    expect(out.customer.platform).toBe('');
    expect(out.customer.customerCode).toBe('C001');
  });

  it('不改传进来的原对象（调用方还要拿原对象去别处推送）', () => {
    const order = fullOrder();
    stripCustomerSource(order);
    expect((order.customFields as any).customerSource).toBe('小红书');
    expect(order.customer.platform).toBe('小红书');
  });

  it('没有 customFields（会话 / 邀请这类对象）也能安全过一遍', () => {
    const session = { id: 's1', type: 'DUAL_INVITE' };
    expect(stripCustomerSource(session)).toBe(session);
    expect(stripCustomerSource(null)).toBe(null);
  });
});

describe('stripCustomerSourceDeep（响应体递归清理）', () => {
  it('{ code, message, data:[订单] } 这种包一层 + 数组都能清到', () => {
    const payload = {
      code: 200,
      message: 'ok',
      data: [
        { id: 'o1', customFields: { customerSource: '小红书', customerSourceAccount: 'ok绷' } },
        { id: 'o2', customFields: { customerSourceAccount: 'ok绷' }, customer: { platform: '小红书' } },
      ],
    };
    const out: any = stripCustomerSourceDeep(payload);
    expect(out.data[0].customFields).not.toHaveProperty('customerSource');
    expect(out.data[0].customFields).not.toHaveProperty('customerSourceAccount');
    expect(out.data[1].customFields).not.toHaveProperty('customerSourceAccount');
    expect(out.data[1].customer.platform).toBe('');
    // 原来的 payload 不动
    expect(payload.data[0].customFields.customerSource).toBe('小红书');
  });

  it('订单里再嵌订单（搭档邀请）也能清到', () => {
    const payload = {
      code: 200,
      data: {
        id: 's1',
        parentOrder: { id: 'o1', customFields: { customerSource: '小红书' } },
      },
    };
    const out: any = stripCustomerSourceDeep(payload);
    expect(out.data.parentOrder.customFields).not.toHaveProperty('customerSource');
  });
});

/**
 * 客户档案（CustomersController）走的是 `{ platform: 'contactOnly' }`：摘 customFields 里的
 * 来源 / 来源账号；`customer.platform` 只有存的是**来源**（小红书 / 抖音…）才清空，
 * 存的是联系方式平台（微信 / QQ / 电话 / 其他）时原样留着 —— 客户档案里这个字段是两用的。
 */
describe("stripCustomerSource(…, { platform: contactOnly })（客户档案：只留联系方式平台）", () => {
  const customer = () => ({
    id: 'cu1',
    platform: 'QQ',
    platformAccount: '12345',
    orders: [{ id: 'o1', customFields: { customerSource: '小红书', customerSourceAccount: 'ok绷' } }],
  });

  it("来源 / 来源账号照删，联系方式平台（QQ）原样留着", () => {
    const out: any = stripCustomerSourceDeep(customer(), { platform: 'contactOnly' });
    expect(out.orders[0].customFields).not.toHaveProperty('customerSource');
    expect(out.orders[0].customFields).not.toHaveProperty('customerSourceAccount');
    expect(out.platform).toBe('QQ');
    expect(out.platformAccount).toBe('12345');
  });

  it('platform 存的是来源（小红书）时照样清掉 —— 客户档案里这个字段兼着来源', () => {
    const out: any = stripCustomerSourceDeep(customer(), { platform: 'contactOnly' });
    const out2: any = stripCustomerSource(
      { customer: { platform: '小红书' } },
      { platform: 'contactOnly' },
    );
    expect(out2.customer.platform).toBe('');
    expect(out.platform).toBe('QQ');
  });

  it('默认（不传 opts）还是订单那套：一律清空', () => {
    const out: any = stripCustomerSource({ customer: { platform: 'QQ' } });
    expect(out.customer.platform).toBe('');
  });

  it('客户对象自己的 platform（GET /customers 的形态）：来源清掉、联系方式平台留着', () => {
    const src = {
      list: [
        { id: 'cu1', customerCode: 'C001', wechatId: 'wx1', platform: '小红书' },
        { id: 'cu2', customerCode: 'C002', wechatId: 'wx2', platform: 'QQ' },
        { id: 'cu3', customerCode: 'C003', wechatId: 'wx3', platform: null },
      ],
    };
    const out: any = stripCustomerSourceDeep(src, { platform: 'contactOnly' });
    expect(out.list[0].platform).toBe('');
    expect(out.list[1].platform).toBe('QQ');
    expect(out.list[2].platform).toBe(null);
    // 原对象不动
    expect(src.list[0].platform).toBe('小红书');
  });

  it('引流账号那种对象也有 platform，但没客户字段，不能被误清', () => {
    const src = { platform: '小红书', accountName: 'ok绷' };
    const out: any = stripCustomerSource(src, { platform: 'contactOnly' });
    expect(out.platform).toBe('小红书');
  });
});
