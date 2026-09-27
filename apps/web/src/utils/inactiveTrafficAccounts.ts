import { trafficAccountApi } from '../api/trafficAccount';

let cachedInactiveAccounts: Set<string> | null = null;
let cachedAt = 0;
let pendingPromise: Promise<Set<string>> | null = null;

/**
 * 引流账号里「已弃用」的那批账号昵称（全站共享一次请求）。
 *
 * 这段缓存原来躺在 OrderRow 里，只有订单池的行能拿到；老板 2026-09-27 把
 * 「派单工作台 → 派单记录」并进订单管理后，订单管理表也要在「来源账号」
 * 旁边标出「已弃用」，所以挪到这里，两边共用同一份缓存、只发一次请求。
 */
export function loadInactiveAccounts(): Promise<Set<string>> {
  if (cachedInactiveAccounts && Date.now() - cachedAt < 5 * 60 * 1000) {
    return Promise.resolve(cachedInactiveAccounts);
  }
  if (pendingPromise) return pendingPromise;
  pendingPromise = trafficAccountApi
    .list('studio')
    .then(({ data }: any) => {
      const inactive = new Set<string>();
      (data.data || []).forEach((a: any) => {
        if (a.status === 'INACTIVE') inactive.add(a.nickname);
      });
      cachedInactiveAccounts = inactive;
      cachedAt = Date.now();
      return inactive;
    })
    .finally(() => {
      pendingPromise = null;
    });
  return pendingPromise;
}
