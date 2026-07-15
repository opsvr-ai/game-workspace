import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';


@Injectable()
export class IdentityVerifyService {
  constructor(private readonly prisma: PrismaService) {}

  async verify(realName: string, idNumber: string): Promise<{ valid: boolean; reason?: string; skipped?: boolean }> {
    const [appCode] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'identity.app_code' } }),
    ]);
    const code = (appCode?.value as string) || '';

    if (!code) {
      return { valid: true, skipped: true, reason: 'API未配置，跳过验证' };
    }

    try {
      const https = require('https');
      return await new Promise((resolve) => {
        const url = `https://eid.shumaidata.com/eid/check?idcard=${idNumber}&name=${encodeURIComponent(realName)}`;
        https.get(url, { headers: { 'Authorization': `APPCODE ${code}` }, timeout: 10000 }, (res: any) => {
          let body = '';
          res.on('data', (d: string) => { body += d; });
          res.on('end', () => {
            try {
              const d = JSON.parse(body);
              if (d.code === 0) resolve({ valid: d.result?.is_identical === true, reason: d.result?.is_identical ? undefined : (d.result?.description || '身份不匹配') });
              else resolve({ valid: false, reason: d.message || '验证失败' });
            } catch { resolve({ valid: false, reason: '响应异常' }); }
          });
        }).on('error', () => resolve({ valid: true, skipped: true }));
      });
    } catch {
      return { valid: true, skipped: true };
    }
  }
}
