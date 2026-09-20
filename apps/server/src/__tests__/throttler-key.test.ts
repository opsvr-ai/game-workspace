// craftsman-ignore: TS001,TS003
import { describe, it, expect } from "vitest";
import { throttleKey, jwtSubject, AppThrottlerGuard } from "../common/app-throttler.guard";

/**
 * 限流按谁记账（老板 2026-09-21 报「秦伟杰登录不上，提示 too many request」）：
 * 工作室几十台机器共用一个公网出口，原来一律按 IP 记账 —— 一个人连输几次密码，
 * 就把整个工作室的登录额度占满，别人跟着 429；订单池轮询也互相挤爆。
 */

function fakeJwt(sub: string): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub })}.sig`;
}

describe("限流按谁记账", () => {
  it("登录按「账号 + 来访 IP」记账：同一个人失败不连累别人", () => {
    const qin = throttleKey({ url: "/api/auth/login", ip: "122.6.1.1", username: "秦伟杰" });
    const wang = throttleKey({ url: "/api/auth/login", ip: "122.6.1.1", username: "王昊" });
    expect(qin).not.toBe(wang);
    expect(qin).toBe("login:122.6.1.1:秦伟杰");
  });

  it("同一账号同一 IP 才算一个桶；换 IP 或大小写不同都算清楚", () => {
    const a = throttleKey({ url: "/api/auth/login", ip: "1.1.1.1", username: "QinWei" });
    const b = throttleKey({ url: "/api/auth/login", ip: "1.1.1.1", username: "qinwei" });
    const c = throttleKey({ url: "/api/auth/login", ip: "2.2.2.2", username: "qinwei" });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it("找回密码同样按账号记账（不然一个人试身份证号能把全公司锁住）", () => {
    const key = throttleKey({ url: "/api/auth/forgot-password", ip: "1.1.1.1", username: "张三" });
    expect(key).toBe("login:1.1.1.1:张三");
  });

  it("登录没填账号时退回按 IP 记账", () => {
    const key = throttleKey({ url: "/api/auth/login", ip: "1.1.1.1", username: "   " });
    expect(key).toBe("ip:1.1.1.1");
  });

  it("带令牌的请求按用户记账：同一个公网出口下每个陪玩各算各的", () => {
    const k1 = throttleKey({ url: "/api/orders/pool", ip: "122.6.1.1", authorization: `Bearer ${fakeJwt("user-a")}` });
    const k2 = throttleKey({ url: "/api/orders/pool", ip: "122.6.1.1", authorization: `Bearer ${fakeJwt("user-b")}` });
    expect(k1).toBe("user:user-a");
    expect(k2).toBe("user:user-b");
    expect(k1).not.toBe(k2);
  });

  it("令牌过期也只是解 payload，照样能分到自己的桶", () => {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const expired = `${enc({ alg: "HS256" })}.${enc({ sub: "user-c", exp: 1 })}.sig`;
    expect(jwtSubject(expired)).toBe("user-c");
  });

  it("没带令牌的匿名请求仍按 IP 记账", () => {
    expect(throttleKey({ url: "/api/studios/public", ip: "9.9.9.9" })).toBe("ip:9.9.9.9");
  });

  it("坏令牌不抛错，退回按 IP 记账", () => {
    expect(throttleKey({ url: "/api/orders", ip: "9.9.9.9", authorization: "Bearer not-a-jwt" })).toBe("ip:9.9.9.9");
    expect(jwtSubject("garbage")).toBe("");
  });

  it("守卫真的用这套规则（getTracker）", async () => {
    const guard = new AppThrottlerGuard([] as never, {} as never, {} as never);
    const asUser = await (guard as any).getTracker({
      ip: "10.0.0.9",
      originalUrl: "/api/orders/pool",
      headers: { authorization: `Bearer ${fakeJwt("u1")}` },
    });
    expect(asUser).toBe("user:u1");

    const asIp = await (guard as any).getTracker({ ip: "10.0.0.9", originalUrl: "/api/studios/public", headers: {} });
    expect(asIp).toBe("ip:10.0.0.9");
  });

  it("被限流时给一句人话，并带上 Retry-After（前端不再显示 ThrottlerException）", async () => {
    const guard = new AppThrottlerGuard([] as never, {} as never, {} as never);
    const headers: Record<string, string> = {};
    const context = { switchToHttp: () => ({ getResponse: () => ({ setHeader: (k: string, v: string) => { headers[k] = v; } }) }) };
    await expect(
      (guard as any).throwThrottlingException(context, { timeToExpire: 42 }),
    ).rejects.toThrow(/操作太频繁，请等 42 秒再试/);
    expect(headers["Retry-After"]).toBe("42");
  });
});
