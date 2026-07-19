import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

@Injectable()
export class AiService {
  constructor(private prisma: PrismaService) {}

  async getAdvice(companionId: string) {
    const orders = await this.prisma.order.findMany({
      where: { companionId, status: 'DONE' },
      select: { type: true, amount: true },
    });
    const totalCount = orders.length;
    const totalAmount = orders.reduce((s, o) => s + o.amount, 0);
    const counts: Record<string, number> = { NEW: 0, RENEW: 0, REPURCHASE: 0, TIP: 0 };
    const amounts: Record<string, number> = { NEW: 0, RENEW: 0, REPURCHASE: 0, TIP: 0 };
    orders.forEach((o) => {
      counts[o.type]++;
      amounts[o.type] += o.amount;
    });
    const newRate = totalCount > 0 ? Math.round((counts.NEW / totalCount) * 100) : 0;
    const renewRate = totalCount > 0 ? Math.round((counts.RENEW / totalCount) * 100) : 0;
    const repurchaseRate = totalCount > 0 ? Math.round((counts.REPURCHASE / totalCount) * 100) : 0;
    const tipRatio = totalAmount > 0 ? Math.round((amounts.TIP / totalAmount) * 100) : 0;

    const apiKey = process.env.DOUBAO_API_KEY;
    if (apiKey) {
      try {
        const prompt = `你是游戏陪玩业绩教练。陪玩数据：总流水¥${totalAmount}，${totalCount}单，首单${newRate}%，续单率${renewRate}%，复购率${repurchaseRate}%，礼物占比${tipRatio}%。行业标准：续单率≥30%，复购率≥30%，礼物≥15%。注意：客户已有微信，不需提加微信。请给3条提高续单/复购/礼物的建议（每条15字内）。例如：打完约下次时间、服务到位直接要礼物、老客户给存单折扣。`;
        const { data } = await axios.post(
          'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
          {
            model: 'ep-20240617223045-7mh8q',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 150,
          },
          { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, timeout: 8000 },
        );
        return { advice: data.choices?.[0]?.message?.content || 'AI 暂时无法响应', fromAI: true };
      } catch (err) {
        console.error('AI API call failed, using local fallback', (err as Error).message);
      }
    }
    const tips: string[] = [];
    if (newRate > 50) tips.push(`首单${newRate}%过高，少打新单多维护老客户`);
    if (renewRate < 30) tips.push(`续单率${renewRate}%不达标：打完主动约下次时间，给存单折扣吸引续费`);
    if (repurchaseRate < 30) tips.push(`复购率${repurchaseRate}%不达标：提高服务质量，记住客户偏好，定期问候`);
    if (tipRatio < 15) tips.push(`礼物${tipRatio}%偏低：服务满意直接开口要礼物，节日生日主动提醒`);
    if (!tips.length) tips.push('🎉 各项指标优秀，继续保持！');
    return { advice: tips.join('。') + '。', fromAI: false };
  }

  async analyzeCustomer(customerId: string) {
    const [profile, customer, orders] = await Promise.all([
      this.prisma.customerProfile.findUnique({ where: { customerId } }),
      this.prisma.customer.findUnique({ where: { id: customerId } }),
      this.prisma.order.findMany({ where: { customerId, status: 'DONE' }, orderBy: { createdAt: 'desc' } }),
    ]);

    if (!customer) throw new NotFoundException('客户不存在');

    const rc = orders.length;
    const rr = rc > 0 ? Math.round((orders.filter((o) => o.type === 'REPURCHASE').length / rc) * 100) : 0;
    const dsl = orders[0] ? Math.floor((Date.now() - orders[0].createdAt.getTime()) / 86400000) : 999;
    const sl = customer.totalSpent >= 500 ? 5 : customer.totalSpent >= 200 ? 3 : 1;
    const ll = rr >= 50 ? 5 : rr >= 30 ? 3 : 1;
    const al = dsl <= 3 ? '高' : dsl <= 7 ? '中' : '低';

    return {
      analysis: {
        spendingPower: { rating: sl },
        loyalty: { rating: ll },
        activity: { level: al, description: dsl <= 999 ? `${dsl}天前` : '无' },
        personality: profile?.customNotes || '暂无',
        interests: '暂无',
      },
      suggestions: {
        bestContactTime: profile?.preferredTime || '晚上20:00',
        recommendedStyle: profile?.likesTalkative ? '活泼型' : '高效型',
        nextRecommendation: rr >= 50 ? '推荐存单' : '提升服务',
      },
      scripts: {
        booking: '老板晚上好！今天来两把？',
        deposit: '老板要不要存个单？存10送2！',
        maintenance: '老板最近还好吗？有空一起打游戏～',
      },
    };
  }
}
