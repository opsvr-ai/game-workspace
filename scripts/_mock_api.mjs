#!/usr/bin/env node
/**
 * 本地「假后台」：把 apps/web/dist 当静态站发出去，同时把 /api/* 全部接管。
 *
 * 为什么需要它：这套系统的页面在本机打不开 —— 进页面要登录、登录要连数据库，
 * 而本机没有数据库。于是「界面到底长什么样、整齐不整齐」只能等上线才看见。
 * 有了它 + scripts/_shot_ui.mjs，就能在**完全离线、不碰线上**的前提下把真实页面截出来：
 * 颜色、间距、对齐、表格列宽这些「改完看不见」的东西，第一次能自己看。
 *
 * 用法：
 *   node scripts/_mock_api.mjs                       # 默认 127.0.0.1:8123
 *   node scripts/_mock_api.mjs --port=8123
 * 然后：
 *   node scripts/_shot_ui.mjs http://127.0.0.1:8123/cs/dispatch out.png \
 *     --pre=scripts/_shot_seed_owner.js --await=.ant-table --w=1600 --full
 *
 * 它**只回答假数据**，请求路径会打进 tmp_shots/_api_log.txt ——
 * 想给某个页面加更真实的数据，照着这份日志补 FIXTURES 即可。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'apps', 'web', 'dist');
const LOG_FILE = path.join(ROOT, 'tmp_shots', '_api_log.txt');

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith('--' + n + '='));
  return hit ? hit.slice(n.length + 3) : d;
};
const PORT = Number(opt('port', 8123));
// --role=OWNER|ADMIN|CS|COMPANION：/auth/me 用哪个身份返回。
// 想看别的角色就再起一个实例、换个 --port 即可（截图脚本用 --base 指过去）。
const ROLE = String(opt('role', 'OWNER')).toUpperCase();
// --delay=<ms>：所有 /api/* 响应人为拖慢这么多毫秒。只用来「看清加载态」——
// 正常速度下数据秒回，截图根本拍不到「正在加载」那一帧。
const DELAY = Number(opt('delay', 0)) || 0;
// --delay-skip=<正则>：这些路径不拖慢（比如 ^/api/auth —— 登录态要秒回，
// 才能把「外壳已经在了、页面自己还在加载」那一帧单独拍下来）。
const DELAY_SKIP = String(opt('delay-skip', ''));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

/** 登录态里的那个「人」。老板角色，能看到全部菜单，最好用来对照界面。 */
const USERS = {
  OWNER: {
    id: 'u-owner-1',
    username: 'hanlei',
    displayName: '韩磊',
    role: 'OWNER',
    studioId: 's-1',
    studioName: '蠢驴电竞',
    avatar: null,
    pendingReviewCount: 0,
  },
  ADMIN: {
    id: 'u-admin-1',
    username: 'dianzhang01',
    displayName: '张店长',
    role: 'ADMIN',
    studioId: 's-1',
    studioName: '蠢驴电竞',
    avatar: null,
    pendingReviewCount: 0,
  },
  CS: {
    id: 'u-cs-1',
    username: 'kefu01',
    displayName: '小美',
    role: 'CS',
    studioId: 's-1',
    studioName: '蠢驴电竞',
    avatar: null,
    pendingReviewCount: 0,
  },
  COMPANION: {
    id: 'u-comp-1',
    username: 'zhangsan',
    displayName: '张三',
    role: 'COMPANION',
    studioId: 's-1',
    studioName: '蠢驴电竞',
    companionId: 'c-1',
    avatar: null,
    pendingReviewCount: 0,
  },
};
const ME = USERS[ROLE] || USERS.OWNER;

/** 按 方法 + 路径 精确/正则匹配的假响应；没命中的一律 { data: null }。 */
/** 相对现在的时间（截图用的假数据里，心跳 / 上报时间都按「几分钟前」算，别写死日期）。 */
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

/** 截图用的假战绩图：SVG data URI。不然 /uploads/... 在本地 404，拍出来一排「图片打不开」。 */
const fakeShot = (label, bg) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="100%" height="100%" fill="${bg}"/>` +
      `<text x="50%" y="50%" fill="#FFFFFF" font-size="20" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`,
  );

const FIXTURES = [
  { m: 'GET', p: /^\/api\/auth\/me$/, body: { data: ME } },
  {
    m: 'POST',
    p: /^\/api\/auth\/login$/,
    body: { data: { accessToken: 'mock-access', refreshToken: 'mock-refresh', user: ME } },
  },
  { m: 'POST', p: /^\/api\/auth\/refresh$/, body: { data: { accessToken: 'mock-access', refreshToken: 'mock-refresh' } } },
  { m: 'GET', p: /^\/api\/config/, body: { data: { data: {} } } },
  // 战绩图审核页（老板 2026-10-09：改成「缩略图直接看」）—— 两组假数据，一组待审一组已采纳。
  {
    m: 'GET',
    p: /^\/api\/battle-screenshots$/,
    body: {
      data: [
        {
          id: 'bs-1',
          companionId: 'c-1',
          images: [
            fakeShot('1 战绩', '#7C3AED'),
            fakeShot('2 战绩', '#2563EB'),
            fakeShot('3 战绩', '#0891B2'),
            fakeShot('4 战绩', '#16A34A'),
          ],
          status: 'PENDING',
          note: null,
          createdAt: ago(35),
          companion: { user: { username: 'tongxiangrui', displayName: '童祥瑞', avatar: null } },
          customer: { customerCode: 'KH20261009', wechatId: 'wx_tongxiang' },
        },
        {
          id: 'bs-2',
          companionId: 'c-2',
          images: [fakeShot('1 战绩', '#EA580C'), fakeShot('2 战绩', '#F59E0B'), fakeShot('3 战绩', '#0891B2')],
          status: 'APPROVED',
          note: '这组留着发小红书',
          createdAt: ago(180),
          companion: { user: { username: 'zhangsan', displayName: '张三', avatar: null } },
          customer: null,
        },
      ],
    },
  },
  // 考勤管理页的客服 / 店长表（班外打卡的时间后面会带金色「班外」小标签）。
  {
    m: 'GET',
    p: /^\/api\/companions\/staff-attendance$/,
    body: {
      data: [
        { id: 'sa-1', userId: 'u-cs-1', date: '2026-10-07T00:00:00.000Z', status: 'PRESENT', loginAt: '2026-10-06T16:12:00.000Z', logoutAt: '2026-10-06T19:51:00.000Z', outsideShift: true, user: { id: 'u-cs-1', username: 'shaozh', displayName: '邵泽慧', role: 'CS', studioId: 's-1' } },
        { id: 'sa-2', userId: 'u-cs-3', date: '2026-10-07T00:00:00.000Z', status: 'LATE', loginAt: '2026-10-07T01:40:00.000Z', logoutAt: null, outsideShift: false, user: { id: 'u-cs-3', username: 'kefu01', displayName: '小美', role: 'CS', studioId: 's-1' } },
        { id: 'sa-3', userId: 'u-admin-1', date: '2026-10-07T00:00:00.000Z', status: 'PRESENT', loginAt: '2026-10-06T16:08:00.000Z', logoutAt: null, outsideShift: true, user: { id: 'u-admin-1', username: 'hanlei1', displayName: 'hanlei1', role: 'ADMIN', studioId: 's-1' } },
      ],
    },
  },
  // 运营看板「今日考勤」卡：把老板 2026-10-07 截图那一幕搬进来（前两行是凌晨 00:0x 的班外打卡）。
  {
    m: 'GET',
    p: /^\/api\/companions\/attendance-today$/,
    body: {
      data: {
        date: '2026-10-07',
        now: '2026-10-07T00:30:00.000Z',
        roles: {
          CS: {
            enabled: true,
            workStart: '09:00',
            workEnd: '18:00',
            counts: { total: 3, late: 1, earlyLeave: 0, absent: 0, notStarted: 0, present: 3, outsideShift: 2 },
            rows: [
              { id: 'u-cs-1', name: '邵泽慧', role: 'CS', online: false, onDuty: false, loginAt: '2026-10-07T00:12:00+08:00', logoutAt: '2026-10-07T03:51:00+08:00', workMinutes: 0, status: 'PRESENT', outsideShift: true },
              { id: 'u-cs-2', name: '孙可馨', role: 'CS', online: false, onDuty: false, loginAt: '2026-10-07T00:00:00+08:00', logoutAt: '2026-10-07T00:13:00+08:00', workMinutes: 0, status: 'PRESENT', outsideShift: true },
              { id: 'u-cs-3', name: '小美', role: 'CS', online: true, onDuty: true, loginAt: '2026-10-07T09:40:00+08:00', logoutAt: null, workMinutes: 0, status: 'LATE', outsideShift: false },
            ],
          },
          ADMIN: {
            enabled: true,
            workStart: '09:00',
            workEnd: '18:00',
            counts: { total: 1, late: 0, earlyLeave: 0, absent: 0, notStarted: 0, present: 1, outsideShift: 1 },
            rows: [
              { id: 'u-admin-1', name: 'hanlei1', role: 'ADMIN', online: true, onDuty: true, loginAt: '2026-10-07T00:08:00+08:00', logoutAt: null, workMinutes: 0, status: 'PRESENT', outsideShift: true },
            ],
          },
        },
      },
    },
  },
  // 运营看板顶部那排 KPI（老板 2026-10-07 问的「今日单量」：「发单」48 是主值，
  // 「已完成」7 是副值 —— 两个数都写进假数据，改前端时不至于看不出效果）。
  {
    m: 'GET',
    p: /^\/api\/dashboard$/,
    body: {
      data: {
        today: {
          totalRevenue: 335,
          orderCount: 7,
          publishedCount: 48,
          onlineCount: 5,
          totalCount: 9,
          acceptRate: 12,
          entertainmentFee: 0,
        },
        tierChanges: [],
        ranking: [],
        alerts: [],
      },
    },
  },
  // 客服提成·今日看板（老板 2026-10-07 问「不能筛选？」的那一页）：照着老板截图里的 4 个人铺，
  // 数字对得上「客服明细」这张表 —— 改筛选条 / 列宽时能直接在截图里看出来。
  {
    m: 'GET',
    p: /^\/api\/finance\/commission\/today$/,
    body: {
      data: {
        date: '2026-10-07',
        config: { fullAttendance: 26 },
        summary: {
          // 照线上 2026-10-06 的真实一屏铺：发单 48 = 没人接 6 + 还没开始首单 28 + 待反馈 5 + 不成功 1 + 成功 8。
          // 「不成功 1」是陪玩报的（听出变声器不打了）—— 就是 2026-10-07 老板问「数量不对吧？」时被吞掉的那一单。
          published: 48, dispatched: 42, success: 8, failed: 1, pending: 5, successRate: 88.9,
          unstarted: 28, notDispatched: 6,
          // 陪玩 / 店长自己建的单：只进全店合计，不进客服明细（界面会说明这个差额）
          otherPublisherOrders: 4, otherPublisherSuccess: 3,
          offlineOrders: 33, offlineFlow: 285, offlineCommission: 5,
          bridgeOrders: 5, bridgeCommission: 0,
          onlineOrders: 0, onlineCommission: 0,
          bridgeMetMonthCount: 0, csCount: 4,
          failReasons: { '听出变声器不打了': 1 },
        },
        csList: [
          {
            userId: 'u-cs-1', username: 'shaozh', displayName: '邵泽慧', poolScope: 'OFFLINE_FIRST',
            baseSalaryYuan: 2100, salaryDaily: 77.8,
            published: 26, dispatched: 23,
            offlineOrders: 21, offlineFlow: 150, offlineCommission: 4,
            monthBridgeUnits: 0, bridgeMetMonth: false, bridgeUnitYuan: 1, nextTierUnits: 182, nextTierYuan: 3,
            bridgeOrders: 3, bridgeTarget: 10, bridgeMet: false, bridgeCommission: 0,
            onlineOrders: 0, onlineCommission: 0,
            success: 4, failed: 1, pending: 2, successRate: 80,
            totalCommission: 4, todayPay: 81.8, monthTotalYuan: 2111,
            offlineSuccess: 4, bridgeSuccess: 0, onlineSuccess: 0,
            failReasons: { '听出变声器不打了': 1 },
          },
          {
            userId: 'u-cs-2', username: 'sunke', displayName: '孙可馨', poolScope: 'ONLINE_FIRST',
            baseSalaryYuan: 2100, salaryDaily: 77.8,
            published: 18, dispatched: 15,
            offlineOrders: 12, offlineFlow: 35, offlineCommission: 1,
            monthBridgeUnits: 0, bridgeMetMonth: false, bridgeUnitYuan: 1, nextTierUnits: 182, nextTierYuan: 3,
            bridgeOrders: 6, bridgeTarget: 10, bridgeMet: false, bridgeCommission: 0,
            onlineOrders: 0, onlineCommission: 0,
            success: 1, failed: 0, pending: 3, successRate: 100,
            totalCommission: 1, todayPay: 78.8, monthTotalYuan: 2103,
            offlineSuccess: 1, bridgeSuccess: 0, onlineSuccess: 0,
            failReasons: {},
          },
          {
            userId: 'u-cs-3', username: 'liyumei', displayName: '李玉妹', poolScope: 'OFFLINE_FIRST',
            baseSalaryYuan: 2100, salaryDaily: 77.8,
            published: 0, dispatched: 0,
            offlineOrders: 0, offlineFlow: 0, offlineCommission: 0,
            monthBridgeUnits: 0, bridgeMetMonth: false, bridgeUnitYuan: 1, nextTierUnits: 182, nextTierYuan: 3,
            bridgeOrders: 0, bridgeTarget: 10, bridgeMet: false, bridgeCommission: 0,
            onlineOrders: 0, onlineCommission: 0,
            success: 0, failed: 0, pending: 0, successRate: null,
            totalCommission: 0, todayPay: 77.8, monthTotalYuan: 2100,
            offlineSuccess: 0, bridgeSuccess: 0, onlineSuccess: 0,
            failReasons: {},
          },
          {
            userId: 'u-cs-4', username: 'duxinyue', displayName: '杜欣悦', poolScope: 'OFFLINE_FIRST',
            baseSalaryYuan: 2100, salaryDaily: 77.8,
            published: 0, dispatched: 0,
            offlineOrders: 0, offlineFlow: 0, offlineCommission: 0,
            monthBridgeUnits: 0, bridgeMetMonth: false, bridgeUnitYuan: 1, nextTierUnits: 182, nextTierYuan: 3,
            bridgeOrders: 0, bridgeTarget: 10, bridgeMet: false, bridgeCommission: 0,
            onlineOrders: 0, onlineCommission: 0,
            success: 0, failed: 0, pending: 0, successRate: null,
            totalCommission: 0, todayPay: 77.8, monthTotalYuan: 2100,
            offlineSuccess: 0, bridgeSuccess: 0, onlineSuccess: 0,
            failReasons: {},
          },
        ],
      },
    },
  },
  // ── 客户端管理 → 电脑（老板 2026-10-07 把「机器管理 / 远程控制 / 客户端版本」合成一张表）──
  // 这张表在前端把四个接口按「使用人」对齐，所以要一起给：台账 / 陪玩实时状态 / 版本 / 手工登记的电脑。
  {
    m: 'GET',
    p: /^\/api\/agent\/machines$/,
    body: {
      code: 200,
      message: 'ok',
      data: {
        diagScriptVersion: '20261007',
        watchdogLatestBuild: '20261007',
        total: 5,
        onlineCount: 4,
        remoteReadyCount: 3,
        clientlessCount: 1,
        items: [
          { machineId: 'm-1', source: 'machine', clientType: 'COMPANION', hostname: 'DESKTOP-WH01', label: '王昊电脑', windowsUser: 'Administrator', loginUser: 'wanghao', loginRole: 'COMPANION', ips: ['192.168.1.11', '10.8.0.3'], primaryIp: '192.168.1.11', mac: '50:EB:F6:EE:0D:7F', os: 'Windows 11 专业版 23H2', appVersion: '1.0.20261021', watchdogBuild: '20261007', remoteReady: true, remoteAccount: 'chunlvops', remotePassword: 'Xk92Lm7q', firstSeenAt: ago(43200), lastSeenAt: ago(1), online: true, diagnosable: true, pendingTasks: 0, lastTaskAt: ago(180), lastTaskStatus: 'done' },
          { machineId: 'm-2', source: 'machine', clientType: 'COMPANION', hostname: 'DESKTOP-LJ02', label: '李静电脑', windowsUser: 'Administrator', loginUser: 'lijing', loginRole: 'COMPANION', ips: ['192.168.1.12'], primaryIp: '192.168.1.12', mac: '50:EB:F6:EE:0D:80', os: 'Windows 10 专业版 22H2', appVersion: '1.0.20261020', watchdogBuild: '20261006', remoteReady: false, remoteAccount: '', remotePassword: '', firstSeenAt: ago(30000), lastSeenAt: ago(2), online: true, diagnosable: true, pendingTasks: 1, lastTaskAt: ago(2), lastTaskStatus: 'running' },
          { machineId: 'm-3', source: 'machine', clientType: 'COMPANION', hostname: 'DESKTOP-ZM03', label: '赵敏电脑', windowsUser: 'Administrator', loginUser: 'zhaomin', loginRole: 'COMPANION', ips: ['192.168.1.13'], primaryIp: '192.168.1.13', mac: '50:EB:F6:EE:0D:81', os: 'Windows 11 家庭版 23H2', appVersion: '1.0.20261020', watchdogBuild: '20260930', remoteReady: true, remoteAccount: 'chunlvops', remotePassword: 'Rk41Zp8s', firstSeenAt: ago(20000), lastSeenAt: ago(95), online: false, diagnosable: true, pendingTasks: 0, lastTaskAt: null, lastTaskStatus: null },
          { machineId: 'm-4', source: 'machine', clientType: 'COMPANION', hostname: 'DESKTOP-CP04', label: '陈鹏电脑', windowsUser: 'Administrator', loginUser: 'chenpeng', loginRole: 'COMPANION', ips: ['192.168.1.14', '172.20.10.4'], primaryIp: '192.168.1.14', mac: '50:EB:F6:EE:0D:82', os: 'Windows 11 专业版 23H2', appVersion: '1.0.20261021', watchdogBuild: '20261007', remoteReady: true, remoteAccount: 'chunlvops', remotePassword: 'Zt77Qm3d', firstSeenAt: ago(15000), lastSeenAt: ago(1), online: true, diagnosable: true, pendingTasks: 0, lastTaskAt: null, lastTaskStatus: null },
          { machineId: 'm-5', source: 'machine', clientType: 'CS', hostname: 'DESKTOP-KF01', label: '客服 01 电脑', windowsUser: 'Administrator', loginUser: 'kefu01', loginRole: 'CS', ips: ['192.168.1.21'], primaryIp: '192.168.1.21', mac: '50:EB:F6:EE:0D:90', os: 'Windows 11 专业版 23H2', appVersion: '1.0.20260938', watchdogBuild: '20261007', remoteReady: true, remoteAccount: 'chunlvops', remotePassword: 'Qp52Vt9n', firstSeenAt: ago(40000), lastSeenAt: ago(1), online: true, diagnosable: true, pendingTasks: 0, lastTaskAt: null, lastTaskStatus: null },
          { machineId: 'm-6', source: 'cs-user', clientType: 'ADMIN', hostname: '', label: 'dianzhang01（旧记录）', windowsUser: '', loginUser: 'dianzhang01', loginRole: 'ADMIN', ips: [], primaryIp: '', mac: '', os: '', appVersion: '1.0.20260900', watchdogBuild: '', remoteReady: false, remoteAccount: '', remotePassword: '', firstSeenAt: null, lastSeenAt: ago(600), online: false, diagnosable: false, pendingTasks: 0, lastTaskAt: null, lastTaskStatus: null },
        ],
      },
    },
  },
  {
    m: 'GET',
    p: /^\/api\/agent\/version-status$/,
    body: {
      code: 200,
      message: 'ok',
      data: {
        latestVersion: '1.0.20261021',
        onlineCount: 3,
        upToDateCount: 2,
        pendingCount: 1,
        list: [
          { companionId: 'c-1', name: '王昊', status: 'AVAILABLE', agentVersion: '1.0.20261021', lastHeartbeat: ago(1), isLatest: true },
          { companionId: 'c-2', name: '李静', status: 'BUSY', agentVersion: '1.0.20261020', lastHeartbeat: ago(2), isLatest: false },
          { companionId: 'c-4', name: '陈鹏', status: 'ENTERTAINMENT', agentVersion: '1.0.20261021', lastHeartbeat: ago(1), isLatest: true },
        ],
      },
    },
  },
  {
    m: 'GET',
    p: /^\/api\/agent\/cs-version-status$/,
    body: {
      code: 200,
      message: 'ok',
      data: [
        { userId: 'u-cs-1', username: 'kefu01', role: 'CS', clientKind: 'cs', version: '1.0.20260938', isLatest: true, ip: '192.168.1.21', lastSeen: ago(1) },
        { userId: 'u-owner-1', username: 'hanlei', role: 'OWNER', clientKind: 'companion', version: '1.0.20261021', isLatest: true, ip: '192.168.1.9', lastSeen: ago(4) },
        { userId: 'u-admin-1', username: 'dianzhang01', role: 'ADMIN', clientKind: 'companion', version: '1.0.20260900', isLatest: false, ip: '192.168.1.31', lastSeen: ago(600) },
      ],
    },
  },
  {
    m: 'GET',
    p: /^\/api\/companions$/,
    body: {
      code: 200,
      message: 'ok',
      data: [
        { id: 'c-1', status: 'AVAILABLE', user: { id: 'u-1', username: 'wanghao', displayName: '王昊' }, pc: { currentMode: 'WORK', isThrottled: false, lastHeartbeat: ago(1) } },
        { id: 'c-2', status: 'BUSY', user: { id: 'u-2', username: 'lijing', displayName: '李静' }, pc: { currentMode: 'ENTERTAINMENT', isThrottled: true, throttleLimitKB: 500, lastHeartbeat: ago(2) } },
        { id: 'c-3', status: 'OFFLINE', user: { id: 'u-3', username: 'zhaomin', displayName: '赵敏' }, pc: null },
        { id: 'c-4', status: 'ENTERTAINMENT', user: { id: 'u-4', username: 'chenpeng', displayName: '陈鹏' }, pc: { currentMode: 'ENTERTAINMENT', isThrottled: false, lastHeartbeat: ago(1) } },
        { id: 'c-5', status: 'RESTING', user: { id: 'u-5', username: 'sunqi', displayName: '孙琦' }, pc: null },
      ],
    },
  },
  {
    m: 'GET',
    p: /^\/api\/managed-pcs$/,
    body: {
      code: 200,
      message: 'ok',
      data: [
        { id: 'mp-1', ip: '192.168.1.11', loginAccount: 'wanghao', macAddress: '50:EB:F6:EE:0D:7F', label: '王昊电脑', enabled: true, online: true, lastAction: 'wake', lastActionAt: ago(300), createdAt: ago(40000), updatedAt: ago(300) },
        { id: 'mp-2', ip: '192.168.1.13', loginAccount: 'zhaomin', macAddress: '50:EB:F6:EE:0D:81', label: '赵敏电脑', enabled: true, online: false, lastAction: null, lastActionAt: null, createdAt: ago(20000), updatedAt: ago(500) },
      ],
    },
  },
];

function log(line) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function json(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function serveStatic(req, res, urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const isFile = path.extname(rel) !== '';
  const full = path.join(DIST, isFile ? rel : 'index.html');
  if (!full.startsWith(DIST) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    // SPA 兜底：没扩展名的路径一律回 index.html（前端自己路由）
    const idx = path.join(DIST, 'index.html');
    if (fs.existsSync(idx)) {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(fs.readFileSync(idx));
      return;
    }
    res.writeHead(404);
    res.end('dist 还没构建：先跑 pnpm --filter @chunlv/web build');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  res.end(fs.readFileSync(full));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  if (!p.startsWith('/api/')) {
    serveStatic(req, res, p);
    return;
  }

  const method = req.method || 'GET';
  let raw = '';
  req.on('data', (c) => {
    raw += c;
    if (raw.length > 2_000_000) req.destroy();
  });
  req.on('end', () => {
    const hit = FIXTURES.find((f) => f.m === method && f.p.test(p));
    log(method + ' ' + p + (url.search ? url.search : '') + (hit ? '  [fixture]' : ''));
    const payload = hit ? hit.body : { data: null };
    const send = () => {
      try {
        if (!res.writableEnded) json(res, payload);
      } catch {
        /* 客户端已经走了（截图脚本常秒退），忽略 */
      }
    };
    const slow = DELAY > 0 && !(DELAY_SKIP && new RegExp(DELAY_SKIP).test(p));
    if (slow) setTimeout(send, DELAY);
    else send();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const ok = fs.existsSync(path.join(DIST, 'index.html'));
  console.log('[mock] 假后台起来了 → http://127.0.0.1:' + PORT + '（身份 ' + ME.role + ' / ' + ME.displayName + '）' + (ok ? '' : '  ⚠ dist 还没构建'));
  console.log('[mock] 请求日志 → tmp_shots/_api_log.txt');
});
