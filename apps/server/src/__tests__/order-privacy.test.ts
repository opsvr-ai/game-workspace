import { describe, it, expect } from 'vitest';
import { canSeeSourceAccount, maskCustomerWechat } from '../common/order-privacy';

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
