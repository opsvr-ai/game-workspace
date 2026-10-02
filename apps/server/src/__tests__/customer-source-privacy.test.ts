import { describe, it, expect, vi } from 'vitest';
import { lastValueFrom, of } from 'rxjs';
import {
  CustomerProfileSourceMaskInterceptor,
  CustomerSourceMaskInterceptor,
} from '../common/customer-source-mask.interceptor';
import { WsGateway } from '../ws/ws.gateway';

/**
 * 客户来源的隐私线（老板 2026-10-02）：
 * 「除了发单工作室的管理端能看到，其他人一律看不到」——
 * 桥接工作室的店长 / 客服、别的店、所有陪玩都看不到；接单方只留微信 / 房间码这类联系方式。
 *
 * 这个文件钉三处：
 *  1. 订单接口拦截器（OrdersController）：**逐条**按工作室判，自家看得到、别家看不到；
 *  2. 客户档案拦截器（CustomersController）：同上，但联系方式平台（QQ / 微信 / 电话）留着；
 *  3. WebSocket 推送（工作室房间 / 陪玩弹窗）：一条都不带来源。
 */

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

const ctxWith = (user: unknown) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;

const run = (interceptor: any, user: unknown, payload: any) =>
  lastValueFrom(interceptor.intercept(ctxWith(user), { handle: () => of(payload) } as any));

const CS_A = { id: 'cs-a', role: 'CS', studioId: 'studio-a' };
const ADMIN_A = { id: 'admin-a', role: 'ADMIN', studioId: 'studio-a' };
const ADMIN_B = { id: 'admin-b', role: 'ADMIN', studioId: 'studio-b' };
const CS_B = { id: 'cs-b', role: 'CS', studioId: 'studio-b' };
const OWNER = { id: 'owner', role: 'OWNER', studioId: null };
const COMPANION_A = { id: 'cp-user', role: 'COMPANION', studioId: 'studio-a', companionId: 'cp1' };

describe('CustomerSourceMaskInterceptor（订单接口）', () => {
  it('桥接工作室的店长：别家的单来源四件套摘干净，微信 / 房间码留着', async () => {
    const out: any = await run(new CustomerSourceMaskInterceptor(), ADMIN_B, {
      data: [orderOf('studio-a')],
    });
    expect(out.data[0].customFields).not.toHaveProperty('customerSource');
    expect(out.data[0].customFields).not.toHaveProperty('customerSourceAccount');
    expect(out.data[0].customFields).not.toHaveProperty('customerNickname');
    expect(out.data[0].customFields).not.toHaveProperty('customerAccountId');
    expect(out.data[0].customer.platform).toBe('');
    expect(out.data[0].customFields.customerWechat).toBe('wx1');
    expect(out.data[0].customFields.customerRoomCode).toBe('8888');
    expect(out.data[0].customer.customerCode).toBe('C001');
  });

  it('桥接工作室的客服：同样看不到', async () => {
    const out: any = await run(new CustomerSourceMaskInterceptor(), CS_B, { data: [orderOf('studio-a')] });
    expect(out.data[0].customFields).not.toHaveProperty('customerSource');
  });

  it('发单工作室的店长 / 客服：一条都不动（混着两张单时只摘别家的）', async () => {
    const forAdmin: any = await run(new CustomerSourceMaskInterceptor(), ADMIN_A, {
      data: [orderOf('studio-a'), orderOf('studio-b')],
    });
    expect(forAdmin.data[0].customFields.customerSource).toBe('小红书');
    expect(forAdmin.data[0].customFields.customerNickname).toBe('小美');
    expect(forAdmin.data[0].customer.platform).toBe('小红书');
    expect(forAdmin.data[1].customFields).not.toHaveProperty('customerSource');

    const forCs: any = await run(new CustomerSourceMaskInterceptor(), CS_A, { data: [orderOf('studio-a')] });
    expect(forCs.data[0].customFields.customerSource).toBe('小红书');
  });

  it('陪玩：自己家的单也看不到来源', async () => {
    const out: any = await run(new CustomerSourceMaskInterceptor(), COMPANION_A, {
      data: [orderOf('studio-a')],
    });
    expect(out.data[0].customFields).not.toHaveProperty('customerSource');
    expect(out.data[0].customFields.customerWechat).toBe('wx1');
  });

  it('全站老板：直接放行（拿到的就是原对象）', async () => {
    const payload = { data: [orderOf('studio-a'), orderOf('studio-b')] };
    const out: any = await run(new CustomerSourceMaskInterceptor(), OWNER, payload);
    expect(out).toBe(payload);
  });
});

describe('CustomerProfileSourceMaskInterceptor（客户档案）', () => {
  it('别家工作室的客户档案：来源清掉，联系方式平台（QQ）留着', async () => {
    const payload = {
      data: [
        { id: 'cu1', studioId: 'studio-a', customerCode: 'C1', wechatId: 'wx1', platform: 'QQ' },
        { id: 'cu2', studioId: 'studio-a', customerCode: 'C2', wechatId: 'wx2', platform: '小红书' },
      ],
    };
    const out: any = await run(new CustomerProfileSourceMaskInterceptor(), ADMIN_B, payload);
    expect(out.data[0].platform).toBe('QQ');
    expect(out.data[1].platform).toBe('');
  });

  it('自家工作室的客户档案：来源照常显示', async () => {
    const payload = { data: [{ id: 'cu1', studioId: 'studio-a', customerCode: 'C1', wechatId: 'wx1', platform: '小红书' }] };
    const out: any = await run(new CustomerProfileSourceMaskInterceptor(), ADMIN_A, payload);
    expect(out.data[0].platform).toBe('小红书');
  });
});

function makeGateway(bridgedIds: string[] = ['studio-b'], matched: any[] = []) {
  const emitted: Array<{ room: string; event: string; data: any }> = [];
  const server = {
    to: (room: string) => ({ emit: (event: string, data: any) => emitted.push({ room, event, data }) }),
  };
  const prisma = { companion: { findMany: vi.fn().mockResolvedValue(matched) } };
  const bridgeService = { getBridgedStudioIds: vi.fn().mockResolvedValue(bridgedIds) };
  const gw = new WsGateway(
    null as never,
    prisma as never,
    bridgeService as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
  (gw as unknown as { server: unknown }).server = server;
  return { gw, emitted, prisma };
}

describe('WebSocket 推送不带客户来源', () => {
  it('broadcastToStudio：工作室房间里混着桥接店的人，所以也摘掉来源', () => {
    const { gw, emitted } = makeGateway();
    gw.broadcastToStudio('studio-a', 'order:pool_updated', orderOf('studio-a'));
    expect(emitted).toHaveLength(1);
    expect(emitted[0].data.customFields).not.toHaveProperty('customerSource');
    expect(emitted[0].data.customFields.customerWechat).toBe('wx1');
  });

  it('broadcastToBridgedStudios：发单店和桥接店的房间收到的都不带来源', async () => {
    const { gw, emitted } = makeGateway();
    await gw.broadcastToBridgedStudios('studio-a', 'order:pool_updated', orderOf('studio-a'));
    expect(emitted.map((e) => e.room)).toEqual(['studio:studio-a', 'studio:studio-b']);
    for (const e of emitted) {
      expect(e.data.customFields).not.toHaveProperty('customerSource');
      expect(e.data.customFields).not.toHaveProperty('customerNickname');
    }
  });

  it('broadcastNewOrder（陪玩弹窗）：不带来源', async () => {
    const { gw, emitted } = makeGateway(['studio-b'], [{ id: 'c1', status: 'AVAILABLE', user: {} }]);
    await gw.broadcastNewOrder('studio-a', orderOf('studio-a'));
    expect(emitted[0].room).toBe('companion:c1');
    expect(emitted[0].data.customFields).not.toHaveProperty('customerSource');
  });

  it('pushOrder（陪玩新单）：不带来源', () => {
    const { gw, emitted } = makeGateway();
    gw.pushOrder('c1', orderOf('studio-a'));
    expect(emitted[0].data.customFields).not.toHaveProperty('customerSource');
  });
});
