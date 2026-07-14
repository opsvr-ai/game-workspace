import { store } from './store';

export interface NotificationPrefs {
  enabled: boolean;
  orderTypes: Record<string, boolean>;
  games: Record<string, boolean>;
  serviceTypes: Record<string, boolean>;
  dispatchTypes: Record<string, boolean>;
  urgency: Record<string, boolean>;
  deltaCount: Record<string, boolean>;
  deltaMission: Record<string, boolean>;
  billingMode: Record<string, boolean>;
  customerSource: Record<string, boolean>;
}

const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  orderTypes: { NEW: true, RENEW: true, REPURCHASE: true, TIP: true },
  games: {},
  serviceTypes: { PLAY_WITH: true, ESCORT: true, DO_TASK: true },
  dispatchTypes: { POOL: true, DIRECT: true },
  urgency: { now: true, later: true },
  deltaCount: { '单': true, '双': true },
  billingMode: { 'hour': true, 'round': true },
  deltaMission: { '机密': true, '绝密': true },
  customerSource: { '小红书': true, '抖音': true, '快手': true, '转介绍': true },
};

export function getNotificationPrefs(): NotificationPrefs {
  try {
    const stored = store.get('notificationPrefs');
    if (stored && typeof stored === 'object') {
      const s = stored as any;
      return {
        ...DEFAULT_PREFS,
        enabled: s.enabled ?? true,
        orderTypes: { ...DEFAULT_PREFS.orderTypes, ...s.orderTypes },
        games: { ...s.games },
        serviceTypes: { ...DEFAULT_PREFS.serviceTypes, ...s.serviceTypes },
        dispatchTypes: { ...DEFAULT_PREFS.dispatchTypes, ...s.dispatchTypes },
        urgency: { ...DEFAULT_PREFS.urgency, ...s.urgency },
        deltaCount: { ...DEFAULT_PREFS.deltaCount, ...s.deltaCount },
        billingMode: { ...DEFAULT_PREFS.billingMode, ...s.billingMode },
        deltaMission: { ...DEFAULT_PREFS.deltaMission, ...s.deltaMission },
        customerSource: { ...DEFAULT_PREFS.customerSource, ...s.customerSource },
      };
    }
  } catch {}
  return { ...DEFAULT_PREFS, orderTypes:{...DEFAULT_PREFS.orderTypes},
    games:{}, serviceTypes:{...DEFAULT_PREFS.serviceTypes},
    dispatchTypes:{...DEFAULT_PREFS.dispatchTypes}, urgency:{...DEFAULT_PREFS.urgency},
 deltaCount:{...DEFAULT_PREFS.deltaCount},
    billingMode:{...DEFAULT_PREFS.billingMode},
    deltaMission:{...DEFAULT_PREFS.deltaMission},
    customerSource:{...DEFAULT_PREFS.customerSource} };
}

export function setNotificationPrefs(prefs: Partial<NotificationPrefs>): void {
  const current = getNotificationPrefs();
  const merged = { ...current, ...prefs,
    orderTypes: { ...current.orderTypes, ...(prefs.orderTypes || {}) },
    games: { ...current.games, ...(prefs.games || {}) },
    serviceTypes: { ...current.serviceTypes, ...(prefs.serviceTypes || {}) },
    dispatchTypes: { ...current.dispatchTypes, ...(prefs.dispatchTypes || {}) },
    urgency: { ...current.urgency, ...(prefs.urgency || {}) },
    deltaCount: { ...current.deltaCount, ...(prefs.deltaCount || {}) },
    billingMode: { ...current.billingMode, ...(prefs.billingMode || {}) },
    deltaMission: { ...current.deltaMission, ...(prefs.deltaMission || {}) },
    customerSource: { ...current.customerSource, ...(prefs.customerSource || {}) },
  };
  store.set('notificationPrefs', merged);
}

export function shouldNotify(order: any): boolean {
  const prefs = getNotificationPrefs();
  if (!prefs.enabled) return false;

  const orderType = order.type || order.orderType;
  if (orderType && prefs.orderTypes[orderType] === false) return false;

  const game = order.gameName || order.game_name;
  if (game && prefs.games[game] !== undefined && !prefs.games[game]) return false;

  const svcType = order.serviceType || order.customFields?.serviceType;
  if (svcType && prefs.serviceTypes[svcType] === false) return false;

  const dispatch = order.dispatchType;
  if (dispatch && prefs.dispatchTypes[dispatch] === false) return false;

  const urg = order.customFields?.urgency || order.urgency;
  if (urg && prefs.urgency[urg] === false) return false;

  const count = order.customFields?.deltaCount;
  if (count && prefs.deltaCount[count] === false) return false;

  const billing = order.customFields?.billingMode;
  if (billing && prefs.billingMode[billing] === false) return false;

  const mission = order.customFields?.deltaMission;
  if (mission && prefs.deltaMission[mission] === false) return false;

  const source = order.customFields?.customerSource;
  if (source && prefs.customerSource[source] === false) return false;

  return true;
}
