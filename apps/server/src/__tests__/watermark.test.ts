import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  containsWatermark,
  dayWatermarkCode,
  dayWatermarkCodeToDate,
  decodeWatermark,
  encodeWatermark,
  stripWatermark,
  userWatermarkCode,
  watermarkPayload,
} from '../common/watermark';
import { InvisibleTextMiddleware } from '../common/invisible-text.middleware';
import { WatermarkService } from '../watermark/watermark.service';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';

/**
 * 客户微信号隐形水印（老板 2026-10-04：「万一……我能顺藤摸瓜找到」）。
 * 锁住四件事：① 打得进去、解得出来；② 只给客户微信打，陪玩/客服自己的工作微信不打；
 * ③ 幂等、不落库（入口消毒）；④ 解不出时给老板一句人话。
 */
const SECRET = 'test-secret';

describe('watermark 编解码', () => {
  it('打水印后明文不变、肉眼看不见，但能解回是谁哪天看的', () => {
    const at = new Date('2026-10-04T10:00:00+08:00');
    const marked = encodeWatermark('wxid_abc123', { userId: 'u-1', secret: SECRET, at });
    expect(marked.startsWith('wxid_abc123')).toBe(true);
    expect(stripWatermark(marked)).toBe('wxid_abc123');
    expect(containsWatermark(marked)).toBe(true);

    const users = [{ id: 'u-1' }, { id: 'u-2' }];
    const hit = decodeWatermark(marked, { users, secret: SECRET });
    expect(hit).toEqual({ userId: 'u-1', day: dayWatermarkCode(at) });
    expect(dayWatermarkCodeToDate(hit!.day)).toBe('2026-10-04');
  });

  it('换一个密钥 / 换一批账号就解不出来（不是随便谁都能反推）', () => {
    const marked = encodeWatermark('wxid_abc123', { userId: 'u-1', secret: SECRET });
    expect(decodeWatermark(marked, { users: [{ id: 'u-1' }], secret: 'other-secret' })).toBeNull();
    expect(decodeWatermark(marked, { users: [{ id: 'u-9' }], secret: SECRET })).toBeNull();
  });

  it('幂等：同一段文本不会被打两遍', () => {
    const once = encodeWatermark('wxid_abc123', { userId: 'u-1', secret: SECRET });
    const twice = encodeWatermark(once, { userId: 'u-2', secret: SECRET });
    expect(twice).toBe(once);
    // 解出来还是第一个人，没被覆盖
    expect(decodeWatermark(twice, { users: [{ id: 'u-1' }, { id: 'u-2' }], secret: SECRET })?.userId).toBe('u-1');
  });

  it('没打水印 / 空值 / 缺密钥 → 不动原文本，也不会报错', () => {
    expect(encodeWatermark('', { userId: 'u-1', secret: SECRET })).toBe('');
    expect(encodeWatermark('wxid', { userId: '', secret: SECRET })).toBe('wxid');
    expect(encodeWatermark('wxid', { userId: 'u-1', secret: '' })).toBe('wxid');
    expect(containsWatermark('wxid_abc123')).toBe(false);
    expect(decodeWatermark('wxid_abc123', { users: [{ id: 'u-1' }], secret: SECRET })).toBeNull();
  });

  it('水印混在一整条聊天记录里也能揪出来', () => {
    const marked = encodeWatermark('wxid_abc123', { userId: 'u-1', secret: SECRET });
    const chat = `老板你看 这个人我加了 ${marked} 他说他也被别的工作室加过`;
    expect(decodeWatermark(chat, { users: [{ id: 'u-1' }], secret: SECRET })?.userId).toBe('u-1');
  });

  it('账号短码稳定且互不相同', () => {
    expect(userWatermarkCode('u-1', SECRET)).toBe(userWatermarkCode('u-1', SECRET));
    expect(userWatermarkCode('u-1', SECRET)).not.toBe(userWatermarkCode('u-2', SECRET));
  });
});

describe('watermarkPayload（接口响应打水印）', () => {
  const opts = { userId: 'u-1', secret: SECRET };

  it('订单列表 / 详情里的 customerWechat（含 customFields）都打上', () => {
    const payload = {
      data: [
        { id: 'o1', customFields: { customerWechat: 'wxid_aaa' } },
        { id: 'o2', customFields: { customerWechat: 'wxid_bbb', customerRoomCode: '1234' } },
      ],
    };
    const out = watermarkPayload(payload, opts) as any;
    expect(stripWatermark(out.data[0].customFields.customerWechat)).toBe('wxid_aaa');
    expect(containsWatermark(out.data[0].customFields.customerWechat)).toBe(true);
    expect(out.data[1].customFields.customerRoomCode).toBe('1234');
  });

  it('客户档案的 wechatId 打上；陪玩 / 客服自己的工作微信（没有 customerCode）不打', () => {
    const payload = {
      customers: [{ id: 'c1', customerCode: 'C001', wechatId: 'wxid_customer' }],
      workWechats: [{ id: 'w1', wechatId: 'wxid_work', companionId: 'p1' }],
      nested: { order: { customer: { customerCode: 'C002', wechatId: 'wxid_customer2' } } },
    };
    const out = watermarkPayload(payload, opts) as any;
    expect(containsWatermark(out.customers[0].wechatId)).toBe(true);
    expect(out.workWechats[0].wechatId).toBe('wxid_work');
    expect(containsWatermark(out.nested.order.customer.wechatId)).toBe(true);
  });

  it('空微信号 / 已打过水印的值不乱动，也不重复打', () => {
    const out = watermarkPayload(
      { customFields: { customerWechat: '' }, a: { customerWechat: 'wxid_x' } },
      opts,
    ) as any;
    expect(out.customFields.customerWechat).toBe('');
    const again = watermarkPayload(out, { userId: 'u-9', secret: SECRET }) as any;
    expect(again.a.customerWechat).toBe(out.a.customerWechat);
  });
});

describe('InvisibleTextMiddleware（入口消毒，保证不落库）', () => {
  it('请求体 / 查询参数里的水印字符被剥掉', () => {
    const dirty = encodeWatermark('wxid_abc123', { userId: 'u-1', secret: SECRET });
    const req: any = {
      path: '/api/customers/c1',
      body: { wechatId: dirty, nested: { list: [dirty] } },
      query: { q: dirty },
    };
    const next = vi.fn();
    new InvisibleTextMiddleware().use(req, {} as any, next);
    expect(req.body.wechatId).toBe('wxid_abc123');
    expect(req.body.nested.list[0]).toBe('wxid_abc123');
    expect(req.query.q).toBe('wxid_abc123');
    expect(next).toHaveBeenCalled();
  });

  it('解码接口例外：老板粘过来的水印字符不能被剥掉', () => {
    const dirty = encodeWatermark('wxid_abc123', { userId: 'u-1', secret: SECRET });
    const req: any = { path: '/api/watermark/decode', body: { text: dirty } };
    new InvisibleTextMiddleware().use(req, {} as any, vi.fn());
    expect(req.body.text).toBe(dirty);
  });

  it('解码接口例外：Nest 把挂载前缀摘掉、req.path 只剩 "/" 时也要识别出来（2026-10-04 线上踩过）', () => {
    const dirty = encodeWatermark('wxid_abc123', { userId: 'u-1', secret: SECRET });
    const req: any = {
      path: '/',
      url: '/',
      baseUrl: '/api/watermark/decode',
      originalUrl: '/api/watermark/decode',
      body: { text: dirty },
    };
    new InvisibleTextMiddleware().use(req, {} as any, vi.fn());
    expect(req.body.text).toBe(dirty);
  });
});

describe('WatermarkService.decode（老板端溯源）', () => {
  let prisma: MockPrisma;
  let service: WatermarkService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = SECRET;
    prisma = createMockPrisma();
    service = new WatermarkService(prisma as any);
    (prisma.user.findMany as any).mockResolvedValue([
      { id: 'u-1', username: 'xzn', displayName: '徐泽宁', role: 'COMPANION', studio: { name: '蠢驴电竞' } },
      { id: 'u-boss', username: 'hanlei', displayName: '韩磊', role: 'OWNER', studio: null },
    ]);
  });

  it('解得出：告诉老板是谁、什么身份、哪家工作室、哪天看到的', async () => {
    const marked = encodeWatermark('wxid_abc123', {
      userId: 'u-1',
      secret: SECRET,
      at: new Date('2026-10-04T12:00:00+08:00'),
    });
    const res = await service.decode(`客户微信：${marked}`);
    expect(res.matched).toBe(true);
    expect(res.displayName).toBe('徐泽宁');
    expect(res.role).toBe('COMPANION');
    expect(res.studioName).toBe('蠢驴电竞');
    expect(res.day).toBe('2026-10-04');
    expect(res.summary).toContain('徐泽宁');
    expect(res.summary).toContain('2026-10-04');
  });

  it('粘的是截图 / 手打的文本（没有水印字符）→ 说人话解释为什么查不到', async () => {
    const res = await service.decode('wxid_abc123');
    expect(res.matched).toBe(false);
    expect(res.reason).toContain('没有水印');
  });

  it('空文本也能给出提示，不报错', async () => {
    const res = await service.decode('   ');
    expect(res.matched).toBe(false);
  });
});