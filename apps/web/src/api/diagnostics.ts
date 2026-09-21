/**
 * 前端故障上报 + 上传链路自检。
 *
 * 为什么要有这个文件（老板 2026-09-21 报「新电脑注册点了提交提示 Network Error」）：
 * 请求在浏览器/Electron 里就失败了，服务端一个字节都没收到 —— 服务端日志里干干净净，
 * 只看服务端永远查不出原因。所以前端把失败原因回传上来，落到服务器 client-errors/ 目录，
 * 管理员直接读文件就能定位；同时在用户面前的弹窗里当场做一次自检，告诉他卡在哪一步。
 *
 * 这里只用 fetch，不引 axios，避免和 api/client.ts 形成循环依赖。
 */

const MAX_REPORTS_PER_PAGE = 8;
let reportCount = 0;

export interface ClientErrorReport {
  phase: string;
  url?: string;
  status?: number | null;
  message?: string;
  detail?: string;
}

/** 上报一条前端故障（失败也别影响主流程）。 */
export function reportClientError(report: ClientErrorReport): void {
  if (reportCount >= MAX_REPORTS_PER_PAGE) return;
  reportCount += 1;
  try {
    void fetch('/api/agent/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...report,
        page: typeof window === 'undefined' ? '' : window.location.pathname,
        ua: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 忽略 */
  }
}

/**
 * 上传链路自检：依次发 纯文字 / 小图 / 大图 三种请求，返回每一步的结果句子。
 *
 * 故意把 idNumber、phone 留空：服务端在「必填字段」这一关就会返回 400，
 * 不会创建任何用户或写库，纯粹用来验证「字节到底有没有到服务器」。
 */
export async function diagnoseUploadPath(sizesKb: number[] = [0, 300, 5000]): Promise<string[]> {
  const lines: string[] = [];
  for (const kb of sizesKb) {
    const formData = new FormData();
    formData.append('username', 'netprobe');
    formData.append('password', 'netprobe123');
    formData.append('realName', 'netprobe');
    formData.append('idNumber', '');
    formData.append('phone', '');
    formData.append('studioId', 'netprobe');
    formData.append('role', 'COMPANION');
    if (kb > 0) {
      const bytes = new Uint8Array(kb * 1024);
      formData.append('idCardFront', new File([bytes], 'probe.jpg', { type: 'image/jpeg' }));
    }
    const startedAt = Date.now();
    const label = kb === 0 ? '① 纯文字请求' : `② 约 ${kb}KB 照片`;
    try {
      const res = await fetch('/api/auth/register', { method: 'POST', body: formData });
      const body = (await res.text()).slice(0, 80);
      lines.push(`${label}：通了（HTTP ${res.status}，${Date.now() - startedAt}ms，${body}）`);
    } catch (err: any) {
      lines.push(`${label}：失败（${String(err?.message || err)}，${Date.now() - startedAt}ms）`);
    }
  }
  return lines;
}