// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { StudiosController } from '../studios/studios.controller';

/**
 * 邀请链接开通工作室也要传店长的身份证正反面（老板 2026-10-10：「你说要我就加」→「做」）。
 *
 * 这条链路（`POST /studios/register-invite`，公开接口 + 限流）以前**连照片字段都没有**：
 * 填个工作室名 + 账号密码就自助开出一家店和一个店长账号（`isAuthorized: true` 直接能用），
 * 在「实名审核」里那个店长是一片空白。现在跟注册那条一个口径：
 *   1. 缺任何一张 → 400，不建工作室、不建账号（事务都不开）；
 *   2. 只传了一张 → 400，并把已收下的那张从磁盘删掉；
 *   3. 格式不对（不是 JPG/PNG/WEBP）→ 400，两张都清掉；
 *   4. 两张齐全 → 交给 service，文件名落进店长的 User（idCardFront / idCardBack）。
 */

function fakeFile(path: string, filename: string, mimetype = 'image/jpeg') {
  return { path, originalname: filename, filename, mimetype, size: 1024 } as any;
}

function setup() {
  const studiosService = {
    // 参数类型要写出来：`vi.fn(async () => …)` 的 calls[0] 是空元组，下面取 args[6] / args[7] 会判越界。
    registerViaInvite: vi.fn(async (..._args: any[]) => ({ studioId: 'st1', username: '店长A' })),
  };
  const controller = new StudiosController(studiosService as any);
  return { controller, studiosService };
}

const BODY = { token: 'tok-1', studioName: '测试工作室', username: '店长A', password: 'abc123' };

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'invite-idcard-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function tempPhoto(name: string): string {
  const p = join(dir, name);
  writeFileSync(p, 'x');
  return p;
}

describe('邀请链接开通工作室必须带店长身份证正反面（老板 2026-10-10）', () => {
  it('一张都没传 → 400，工作室和账号都不建', async () => {
    const { controller, studiosService } = setup();

    const res: any = await controller.registerInvite({ ...BODY } as any, undefined);

    expect(res.code).toBe(400);
    expect(res.message).toContain('身份证正反面');
    expect(studiosService.registerViaInvite).not.toHaveBeenCalled();
  });

  it('只传正面 → 400，并把已经收下的那张删掉', async () => {
    const { controller, studiosService } = setup();
    const front = tempPhoto('front.jpg');

    const res: any = await controller.registerInvite(
      { ...BODY } as any,
      { idCardFront: [fakeFile(front, 'front.jpg')] } as any,
    );

    expect(res.code).toBe(400);
    expect(res.message).toContain('身份证正反面');
    expect(existsSync(front)).toBe(false);
    expect(studiosService.registerViaInvite).not.toHaveBeenCalled();
  });

  it('格式不支持 → 400，两张都清掉', async () => {
    const { controller, studiosService } = setup();
    const front = tempPhoto('front.jpg');
    const back = tempPhoto('back.txt');

    const res: any = await controller.registerInvite(
      { ...BODY } as any,
      {
        idCardFront: [fakeFile(front, 'front.jpg')],
        idCardBack: [fakeFile(back, 'back.txt', 'text/plain')],
      } as any,
    );

    expect(res.code).toBe(400);
    expect(res.message).toContain('格式不支持');
    expect(existsSync(front)).toBe(false);
    expect(existsSync(back)).toBe(false);
    expect(studiosService.registerViaInvite).not.toHaveBeenCalled();
  });

  it('两张齐全 → 照常开通，两张照片文件名交给 service', async () => {
    const { controller, studiosService } = setup();
    const front = tempPhoto('front.jpg');
    const back = tempPhoto('back.jpg');

    const res: any = await controller.registerInvite(
      { ...BODY } as any,
      { idCardFront: [fakeFile(front, 'front.jpg')], idCardBack: [fakeFile(back, 'back.jpg')] } as any,
    );

    expect(res.code).toBe(200);
    const args = studiosService.registerViaInvite.mock.calls[0];
    expect(args[6]).toBe('front.jpg');
    expect(args[7]).toBe('back.jpg');
    // 成功的照片不能被清掉
    expect(existsSync(front)).toBe(true);
    expect(existsSync(back)).toBe(true);
  });
});
