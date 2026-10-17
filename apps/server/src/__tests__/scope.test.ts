import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import {
  Actor,
  actorOfStudio,
  actorOfUser,
  assertStudioAccess,
  canAccessStudio,
  isAllStudiosActor,
  isCompanionActor,
  remapScopeField,
  scopeWhere,
  selfWhere,
  visibleStudioIds,
} from '../common/scope';

/**
 * ScopeContext 纯函数单测（不依赖数据库 / Nest 容器）。
 *
 * 覆盖四种口径：
 *  老板全站 → 店长 / 客服本店 → 陪玩只看自己 → 桥接店可见；
 * 以及最容易出事的一条：**没挂工作室的店长 / 客服，绝不能因为 studioId 为空就看到全站**。
 *
 * 这些断言同时锁住「行为等价」：除了桥接模式（老代码就是 `in`），单店时必须是裸字符串，
 * 店长没店时必须是 `{ studioId: null }` —— 与迁移前的 where 片段一字不差。
 */

const owner: Actor = { id: 'u-owner', role: 'OWNER', studioId: null };
const admin: Actor = { id: 'u-admin', role: 'ADMIN', studioId: 's1' };
const cs: Actor = { id: 'u-cs', role: 'CS', studioId: 's1' };
const companion: Actor = { id: 'u-c1', role: 'COMPANION', studioId: 's1', companionId: 'c1' };

describe('ScopeContext · Actor 构造', () => {
  it('从 req.user 构造：id / role / studioId / companionId 原样带过来', () => {
    expect(actorOfUser({ id: 'u1', role: 'ADMIN', studioId: 's1', companionId: 'c1' })).toEqual({
      id: 'u1',
      role: 'ADMIN',
      studioId: 's1',
      companionId: 'c1',
    });
  });

  it('匿名 / 缺字段：最保守（不是老板、没有店）', () => {
    expect(actorOfUser(null)).toEqual({
      id: '',
      role: null,
      studioId: null,
      companionId: undefined,
    });
    expect(actorOfUser({})).toEqual({ id: '', role: null, studioId: null, companionId: undefined });
  });

  it('陪玩档案不存在时 companionId 保留 undefined（不能变成 null，那会匹配「未分配」数据）', () => {
    const a = actorOfUser({ id: 'u1', role: 'COMPANION', studioId: 's1', companionId: undefined });
    expect(a.companionId).toBeUndefined();
  });

  it('从老签名 studioId 构造：null 按「老板全站」老口径处理', () => {
    expect(actorOfStudio(null)).toEqual({ id: '', role: 'OWNER', studioId: null });
    expect(actorOfStudio('s1')).toEqual({ id: '', role: 'ADMIN', studioId: 's1' });
    expect(actorOfStudio('s1', 'CS')).toEqual({ id: '', role: 'CS', studioId: 's1' });
  });
});

describe('ScopeContext · visibleStudioIds（谁的工作室可见）', () => {
  it('老板：全站（null），桥接参数也不影响', () => {
    expect(visibleStudioIds(owner)).toBeNull();
    expect(visibleStudioIds(owner, ['s2'])).toBeNull();
  });

  it('店长 / 客服：本店', () => {
    expect(visibleStudioIds(admin)).toEqual(['s1']);
    expect(visibleStudioIds(cs)).toEqual(['s1']);
  });

  it('店长 / 客服 + 桥接店：本店在前、去重、保序', () => {
    expect(visibleStudioIds(admin, ['s2', 's3'])).toEqual(['s1', 's2', 's3']);
    // 桥接表里带上了自己（数据异常）：去重，不会出现 ['s1','s1']
    expect(visibleStudioIds(admin, ['s1', 's2'])).toEqual(['s1', 's2']);
  });

  it('陪玩：也按本店 + 桥接（实时看板要能看到桥接工作室的人）', () => {
    expect(visibleStudioIds(companion)).toEqual(['s1']);
    expect(visibleStudioIds(companion, ['s2'])).toEqual(['s1', 's2']);
  });

  it('没挂工作室的店长 / 客服：空列表（绝不等于全站）', () => {
    const homeless: Actor = { id: 'u-x', role: 'ADMIN', studioId: null };
    expect(visibleStudioIds(homeless)).toEqual([]);
    expect(visibleStudioIds(homeless, ['s2'])).toEqual(['s2']);
  });
});

describe('ScopeContext · scopeWhere（迁移用的 where 片段）', () => {
  it('老板：{}（全站，不加过滤）', () => {
    expect(scopeWhere(owner)).toEqual({});
    expect(scopeWhere(owner, { bridgedIds: ['s2'] })).toEqual({});
  });

  it('店长 / 客服：{ studioId: 本店 }（裸字符串，与老代码一致）', () => {
    expect(scopeWhere(admin)).toEqual({ studioId: 's1' });
    expect(scopeWhere(cs)).toEqual({ studioId: 's1' });
  });

  it('桥接模式：{ studioId: { in: [本店, ...桥接] } }（与老代码形状一致）', () => {
    expect(scopeWhere(admin, { bridgedIds: ['s2'] })).toEqual({ studioId: { in: ['s1', 's2'] } });
    expect(scopeWhere(admin, { bridgedIds: [] })).toEqual({ studioId: { in: ['s1'] } });
  });

  it('陪玩 + ownField：只看自己（本店同事也不给）', () => {
    expect(scopeWhere(companion, { ownField: 'companionId' })).toEqual({ companionId: 'c1' });
    // 陪玩没挂档案：值保留 undefined（Prisma 会忽略这个条件），跟老代码一模一样
    const noProfile: Actor = { id: 'u-x', role: 'COMPANION', studioId: 's1' };
    expect(scopeWhere(noProfile, { ownField: 'companionId' })).toEqual({ companionId: undefined });
  });

  it('陪玩不传 ownField：退回本店（例如实时看板要看本店同事）', () => {
    expect(scopeWhere(companion)).toEqual({ studioId: 's1' });
  });

  it('没挂工作室的店长 / 客服：{ studioId: null } —— 一条都不多给，跟老代码 `where.studioId = user.studioId` 等价', () => {
    const homeless: Actor = { id: 'u-x', role: 'ADMIN', studioId: null };
    expect(scopeWhere(homeless)).toEqual({ studioId: null });
    expect(scopeWhere(homeless, { ownField: 'companionId' })).toEqual({ studioId: null });
  });

  it('可换字段名 / 也可显式传 null actor 走老「不加过滤」口径', () => {
    expect(scopeWhere(admin, { field: 'companion.studioId' })).toEqual({ 'companion.studioId': 's1' });
    expect(scopeWhere(null)).toEqual({});
    expect(scopeWhere(undefined)).toEqual({});
  });

  it('等价性回归：迁移前的老写法逐字比对新写法', () => {
    const legacy = (studioId: string | null) => (studioId ? { studioId } : {});
    for (const studioId of [null, 's1']) {
      expect(scopeWhere(actorOfStudio(studioId))).toEqual(legacy(studioId));
    }
    const legacyBridged = (studioId: string, bridged: string[]) => ({
      studioId: { in: [studioId, ...bridged] },
    });
    expect(scopeWhere(actorOfStudio('s1'), { bridgedIds: ['s2', 's3'] })).toEqual(
      legacyBridged('s1', ['s2', 's3']),
    );
  });
});

describe('ScopeContext · 访问断言（assertStudioAccess / canAccessStudio）', () => {
  it('老板：任何店都能访问', () => {
    expect(canAccessStudio(owner, 's1')).toBe(true);
    expect(canAccessStudio(owner, 's2')).toBe(true);
    expect(() => assertStudioAccess(owner, 's2')).not.toThrow();
  });

  it('店长 / 客服 / 陪玩：只能访问本店', () => {
    expect(canAccessStudio(admin, 's1')).toBe(true);
    expect(canAccessStudio(cs, 's1')).toBe(true);
    expect(canAccessStudio(companion, 's1')).toBe(true);
    expect(canAccessStudio(admin, 's2')).toBe(false);
    expect(() => assertStudioAccess(admin, 's2')).toThrow(ForbiddenException);
    expect(() => assertStudioAccess(cs, 's2')).toThrow(ForbiddenException);
    expect(() => assertStudioAccess(companion, 's2')).toThrow(ForbiddenException);
  });

  it('桥接店可见：传了 bridgedIds 才放行', () => {
    expect(canAccessStudio(admin, 's2', { bridgedIds: ['s2'] })).toBe(true);
    expect(() => assertStudioAccess(admin, 's2', { bridgedIds: ['s2'] })).not.toThrow();
    expect(() => assertStudioAccess(admin, 's3', { bridgedIds: ['s2'] })).toThrow(ForbiddenException);
  });

  it('没挂店的账号 / 空目标 / 匿名：一律拒绝（空 id 绝不等价于全站）', () => {
    const homeless: Actor = { id: 'u-x', role: 'ADMIN', studioId: null };
    expect(canAccessStudio(homeless, 's1')).toBe(false);
    expect(canAccessStudio(admin, null)).toBe(false);
    expect(canAccessStudio(admin, '')).toBe(false);
    expect(canAccessStudio(null, 's1')).toBe(false);
    expect(() => assertStudioAccess(null, 's1')).toThrow(ForbiddenException);
    // 错误消息不泄露目标店的 id
    try {
      assertStudioAccess(admin, 'secret-studio');
    } catch (e: any) {
      expect(String(e.message)).not.toContain('secret-studio');
      expect(String(e.message)).toContain('s1');
    }
  });
});

describe('ScopeContext · 小工具', () => {
  it('isAllStudiosActor / isCompanionActor', () => {
    expect(isAllStudiosActor(owner)).toBe(true);
    expect(isAllStudiosActor(admin)).toBe(false);
    expect(isAllStudiosActor(null)).toBe(false);
    expect(isCompanionActor(companion)).toBe(true);
    expect(isCompanionActor(admin)).toBe(false);
  });

  it('selfWhere：陪玩只看自己，其它角色为空片段', () => {
    expect(selfWhere(companion)).toEqual({ companionId: 'c1' });
    expect(selfWhere(companion, 'coCompanionId')).toEqual({ coCompanionId: 'c1' });
    expect(selfWhere(admin)).toEqual({});
    expect(selfWhere(null)).toEqual({});
  });

  it('remapScopeField：只改字段名，不改判定', () => {
    expect(remapScopeField({ studioId: 's1', archivedAt: null }, 'studioId', 'companion.studioId')).toEqual({
      'companion.studioId': 's1',
      archivedAt: null,
    });
    expect(remapScopeField({ archivedAt: null }, 'studioId', 'companion.studioId')).toEqual({
      archivedAt: null,
    });
  });
});
