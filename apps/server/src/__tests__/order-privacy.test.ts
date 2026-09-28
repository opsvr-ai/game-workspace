import { describe, it, expect } from 'vitest';
import {
  canSeeCustomerSource,
  canSeeSourceAccount,
  maskCustomerWechat,
  stripCustomerSource,
  stripCustomerSourceDeep,
} from '../common/order-privacy';

/**
 * 来源账号（发笔记的那个小红书 / 抖音号）的可见性 —— 老板 2026-09-28 定的口径：
 * 「客服只显示自己的就可以了，店长跟老板可以看到全局的」。
 *
 * 为什么要有这份测试：线上只有店长 / 老板账号能验（客服账号没密码），
 * 而偏偏「客服只看自己的」这条分支只跑在客服登录时才走到，
 * 所以这里把四种角色都钉死，免得以后再被改成 `o.csUserId !== user.id` 那种
 * 「店长也一起被抹掉」的写法（线上就是这么抹了 75 条）。
 */

const order = (csUserId: string) => ({ id: 'o1', csUserId, customFields: { customerSourceAccount: 'ok绷' } });

describe('canSeeSourceAccount（来源账号可见性）', () => {
  it('陪玩看不到（陪玩端那一列本来也不渲染）', () => {
    expect(canSeeSourceAccount({ id: 'c1', role: 'COMPANION', companionId: 'cp1' }, order('cs1'))).toBe(false);
  });

  it('客服只看得到自己发布的单', () => {
    expect(canSeeSourceAccount({ id: 'cs1', role: 'CS' }, order('cs1'))).toBe(true);
    expect(canSeeSourceAccount({ id: 'cs1', role: 'CS' }, order('cs2'))).toBe(false);
  });

  it('店长 / 老板看全局（以前这两类会被整张表抹成 ***）', () => {
    expect(canSeeSourceAccount({ id: 'admin1', role: 'ADMIN' }, order('cs2'))).toBe(true);
    expect(canSeeSourceAccount({ id: 'owner1', role: 'OWNER' }, order('cs2'))).toBe(true);
  });

  it('没有登录用户时一律不给看', () => {
    expect(canSeeSourceAccount(null, order('cs1'))).toBe(false);
    expect(canSeeSourceAccount(undefined, order('cs1'))).toBe(false);
  });
});

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
 * 客户来源（小红书 / 抖音…）对陪玩端整体消失 —— 老板 2026-09-29「陪玩端 隐藏 客户小红书信息」。
 * 只抹账号（`***`）是不够的：留着「小红书」三个字，陪玩照样知道这单从哪来。
 */
describe('canSeeCustomerSource（客户来源可见性）', () => {
  it('陪玩看不到；客服 / 店长 / 老板照常', () => {
    expect(canSeeCustomerSource({ id: 'c1', role: 'COMPANION', companionId: 'cp1' })).toBe(false);
    expect(canSeeCustomerSource({ id: 'cs1', role: 'CS' })).toBe(true);
    expect(canSeeCustomerSource({ id: 'admin1', role: 'ADMIN' })).toBe(true);
    expect(canSeeCustomerSource({ id: 'owner1', role: 'OWNER' })).toBe(true);
  });

  it('没有登录用户（socket / 匿名）一律不给看', () => {
    expect(canSeeCustomerSource(null)).toBe(false);
    expect(canSeeCustomerSource(undefined)).toBe(false);
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

  it('来源平台 + 来源账号直接删键（不是抹成 ***），陪玩要用的联系方式原样留着', () => {
    const out: any = stripCustomerSource(fullOrder());
    expect(out.customFields).not.toHaveProperty('customerSource');
    expect(out.customFields).not.toHaveProperty('customerSourceAccount');
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
