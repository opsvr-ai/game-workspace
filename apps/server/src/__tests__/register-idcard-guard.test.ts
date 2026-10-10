// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RegisterController } from '../auth/register.controller';

/**
 * 注册必须带身份证正反面（老板 2026-10-10）。
 *
 * 老板原话：「为什么陪玩上传身份证的时候你说稍后也行？没有就注册不了，懂了么」。
 * 以前注册页留了一个「照片一直传不上去？先不带照片提交（店长稍后补传）」的口子，
 * 结果实名审核那一栏一直是空的 —— 要核的人核不了，说好补传的也没人补。
 *
 * 现在前端那个入口拿掉了，**服务端也必须拦一道**：否则直接调接口（或老客户端）
 * 还是能塞一个没有身份证的账号进来，等于没拦。这里锁住三件事：
 *   1. 一张都没传 → 400，且一行都不写库；
 *   2. 只传了一张 → 400，并且把已经收下的那张从磁盘上删掉（不留半份材料）；
 *   3. 正反面都在 → 照常注册，两张照片落进 Companion。
 */

function fakeFile(path: string, filename: string) {
  return { path, originalname: filename, filename, mimetype: 'image/jpeg', size: 1024 } as any;
}

function setup() {
  const prisma = {
    user: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: any) => ({ id: 'u1', username: args?.data?.username, companion: null })),
    },
    companion: { findFirst: vi.fn(async () => null) },
  };
  const identityVerify = { verify: vi.fn(async () => ({ valid: true })) };
  const wsGateway = { notifyManagers: vi.fn(), notifyUser: vi.fn() };
  const controller = new RegisterController(prisma as any, identityVerify as any, wsGateway as any);
  return { controller, prisma, identityVerify, wsGateway };
}

const BODY = {
  username: '新陪玩',
  password: 'abc123',
  realName: '张三',
  idNumber: '110101199003077213',
  phone: '13800000000',
  studioId: 's1',
  role: 'COMPANION',
  registerRole: 'OFFLINE_COMPANION',
};

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reg-idcard-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 造一张真文件（控制器失败时会真的去 unlink，得让路径存在） */
function tempPhoto(name: string): string {
  const p = join(dir, name);
  writeFileSync(p, 'x');
  return p;
}

describe('注册必须上传身份证正反面（老板 2026-10-10）', () => {
  it('一张都没传 → 400「身份证正反面」，并且不写库', async () => {
    const { controller, prisma } = setup();

    const res: any = await controller.register({ ...BODY } as any, undefined);

    expect(res.code).toBe(400);
    expect(res.message).toContain('身份证正反面');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('只传正面 → 400，并把已经收下的那张删掉', async () => {
    const { controller, prisma } = setup();
    const front = tempPhoto('front.jpg');

    const res: any = await controller.register(
      { ...BODY } as any,
      { idCardFront: [fakeFile(front, 'front.jpg')] } as any,
    );

    expect(res.code).toBe(400);
    expect(res.message).toContain('身份证正反面');
    expect(existsSync(front)).toBe(false);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('正反面都在 → 照常注册（201），两张照片落进 Companion', async () => {
    const { controller, prisma } = setup();
    const front = tempPhoto('front.jpg');
    const back = tempPhoto('back.jpg');

    const res: any = await controller.register(
      { ...BODY } as any,
      { idCardFront: [fakeFile(front, 'front.jpg')], idCardBack: [fakeFile(back, 'back.jpg')] } as any,
    );

    expect(res.code).toBe(201);
    const created = prisma.user.create.mock.calls[0][0].data;
    expect(created.companion.create.idCardFront).toBe('front.jpg');
    expect(created.companion.create.idCardBack).toBe('back.jpg');
    // 照片是本次注册收下的，不该被当成失败清理掉
    expect(existsSync(front)).toBe(true);
    expect(existsSync(back)).toBe(true);
  });
});
