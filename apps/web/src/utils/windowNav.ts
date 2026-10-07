// craftsman-ignore: TS001
/**
 * 「让**主程序窗口**跳到某一张订单」—— 独立聊天窗口点「查看订单」用的跨窗口通道。
 *
 * 老板 2026-10-07 报的 bug：聊天窗口（一个联系人一个独立系统窗口）里点聊天框顶上那行单号，
 * 整个聊天窗口跳成了订单管理页 —— 原话「找不到跟宋树祥的聊天内容了」。
 * 当时的做法是**另开一个订单管理窗口**（聊天窗口原地不动）。老板 2026-10-08 又问：
 * 「直接跳到订单管理不行？为啥还得搞窗口？」—— 对：不该再开窗口，该让**主程序窗口**去跳。
 *
 * 为什么不能直接 navigate 了事：聊天窗口本身就是个独立窗口，navigate 等于把「跟某人的聊天」
 * 换成订单管理页（那正是那个 bug）。
 *
 * 怎么跨窗口：
 *   ① 浏览器里 window.open 出来的聊天窗口 → 直接指挥它爸（window.opener），同步、稳；
 *   ② 独立系统窗口（Electron 用 IPC 新建的，没有 opener）→ 走 localStorage + storage 事件：
 *      写一个「请跳这个地址」的键，**同源的其它窗口**（主程序那个）会收到 storage 事件
 *      （写的人自己收不到，正好不会自己跳自己），跳完回写一个 ack；写的人拿到 ack 就知道真跳了。
 *      storage 事件是**事件**不是定时器 —— 主程序窗口在后台 / 最小化也照样收得到，不像轮询会被节流。
 *
 * 调用方拿到 false = 没有任何「主程序窗口」应答（被关掉了 / 不是我们的客户端）。
 * 这时候**不要再开新窗口**：await 之后已经没有用户手势了，浏览器一定会拦（老板 2026-10-08
 * 报的就是「浏览器拦了新窗口」那条提示），直接告诉人「先从任务栏打开主程序再点」更实在。
 */

const NAV_KEY = 'chunlv:window-nav';
const ACK_KEY = 'chunlv:window-nav-ack';

interface NavMessage {
  id?: string;
  url?: string;
}

/**
 * 主程序窗口这边：收到「请跳这个地址」就 navigate，顺手把窗口提到前面，然后回一个 ack。
 * 返回取消订阅函数（组件卸载时调）。
 */
export function installWindowNavListener(navigate: (url: string) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== NAV_KEY || !e.newValue) return;
    let msg: NavMessage;
    try {
      msg = JSON.parse(e.newValue) as NavMessage;
    } catch {
      return; // 不是我们写的，忽略
    }
    if (!msg?.url || !msg?.id) return;
    try {
      navigate(String(msg.url));
    } catch {
      /* 地址不合法就算了，别把整个窗口拖崩 */
    }
    try {
      window.focus(); // 顶不顶得到最前面看系统，尽力而为
    } catch {
      /* 忽略 */
    }
    try {
      localStorage.setItem(ACK_KEY, JSON.stringify({ id: msg.id, at: Date.now() }));
    } catch {
      /* 存不下就算了 */
    }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/**
 * 浏览器里 window.open 出来的聊天窗口：直接让**开着它的那个窗口**跳过去 —— 同步完成，
 * 所以不存在「弹窗被拦」这件事。返回 false = 没有 opener（独立系统窗口 / 手输地址打开的），
 * 接着走 installWindowNavListener 那条通道。
 */
export function navigateOpenerWindow(url: string): boolean {
  try {
    const opener = window.opener as Window | null;
    if (!opener || opener.closed) return false;
    opener.location.href = url; // 同源才能这么干；跨源会抛，抛了就当没有 opener
    opener.focus();
    return true;
  } catch {
    return false;
  }
}

/** 请「另一个窗口」（主程序）跳到这个地址；拿到 ack 或超时结束。 */
export function navigateInOtherWindow(url: string, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener('storage', onStorage);
      window.clearTimeout(timer);
      resolve(ok);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ACK_KEY || !e.newValue) return;
      try {
        const ack = JSON.parse(e.newValue) as NavMessage;
        if (ack?.id === id) finish(true);
      } catch {
        /* 不是我们写的，忽略 */
      }
    };
    window.addEventListener('storage', onStorage);
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    try {
      // id 每次都不同 —— 同一个地址连点两次也一定是「新值」，storage 事件才会照常触发。
      localStorage.setItem(NAV_KEY, JSON.stringify({ id, url, at: Date.now() }));
    } catch {
      finish(false);
    }
  });
}