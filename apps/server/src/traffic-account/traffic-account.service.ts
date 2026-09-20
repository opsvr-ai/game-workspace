import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveConfigsRaw, saveConfigsByRole } from '../common/studio-config';

@Injectable()
export class TrafficAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: any, scope?: string) {
    const where: any = {};
    if (scope === 'studio') {
      // 发布订单等场景：显示本工作室全部引流账号（客服可替请假的同事看账号）
      if (user.studioId) where.studioId = user.studioId;
    } else if (user.role === 'COMPANION' || user.role === 'CS') {
      where.userId = user.id;
    } else if (user.studioId) {
      where.studioId = user.studioId;
    }
    return this.prisma.trafficAccount.findMany({
      where,
      include: { user: { select: { username: true, displayName: true } } },
      orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(user: any, dto: {
    type: string;
    nickname: string;
    code?: string;
    trafficLevel?: string;
    accountRole?: string;
    accountStyle?: string;
    accountId?: string;
    wifi?: string;
    wifiRegion?: string;
    riskPopped?: string;
    riskNote?: string;
    banned?: string;
    banNote?: string;
    phone?: string;
    promotionContact?: string;
    realName?: string;
    realNameAge?: number;
    realNameGender?: string;
    followers?: number;
    registerDate?: string;
    banDate?: string;
    imageSourceNote?: string;
    imageFolder?: string;
    otherNote?: string;
    extra?: Record<string, any>;
    notes?: string;
    userId?: string;
  }) {
    if (!user.studioId) throw new ForbiddenException('无工作室权限');
    const ownerId = user.role === 'CS' || user.role === 'COMPANION' ? user.id : (dto.userId || user.id);
    if (!dto.type?.trim() || !dto.nickname?.trim()) {
      throw new ForbiddenException('类型和昵称必填');
    }
    return this.prisma.trafficAccount.create({
      data: {
        studioId: user.studioId,
        userId: ownerId,
        type: dto.type.trim(),
        code: dto.code?.trim() || null,
        trafficLevel: dto.trafficLevel?.trim() || null,
        accountRole: dto.accountRole?.trim() || null,
        accountStyle: dto.accountStyle?.trim() || null,
        nickname: dto.nickname.trim(),
        accountId: dto.accountId?.trim() || null,
        wifi: dto.wifi?.trim() || null,
        wifiRegion: dto.wifiRegion?.trim() || null,
        riskPopped: dto.riskPopped?.trim() || null,
        riskNote: dto.riskNote?.trim() || null,
        banned: dto.banned?.trim() || null,
        banNote: dto.banNote?.trim() || null,
        phone: dto.phone?.trim() || null,
        promotionContact: dto.promotionContact?.trim() || null,
        realName: dto.realName?.trim() || null,
        realNameAge: dto.realNameAge != null ? Number(dto.realNameAge) : null,
        realNameGender: dto.realNameGender?.trim() || null,
        followers: dto.followers != null ? Number(dto.followers) : null,
        registerDate: dto.registerDate?.trim() || null,
        banDate: dto.banDate?.trim() || null,
        imageSourceNote: dto.imageSourceNote?.trim() || null,
        imageFolder: dto.imageFolder?.trim() || null,
        otherNote: dto.otherNote?.trim() || null,
        extra: dto.extra || {},
        notes: dto.notes?.trim() || null,
      },
    });
  }

  async update(user: any, id: string, dto: {
    type?: string;
    code?: string;
    trafficLevel?: string;
    accountRole?: string;
    accountStyle?: string;
    nickname?: string;
    accountId?: string;
    wifi?: string;
    wifiRegion?: string;
    riskPopped?: string;
    riskNote?: string;
    banned?: string;
    banNote?: string;
    phone?: string;
    promotionContact?: string;
    realName?: string;
    realNameAge?: number;
    realNameGender?: string;
    followers?: number;
    registerDate?: string;
    banDate?: string;
    imageSourceNote?: string;
    imageFolder?: string;
    otherNote?: string;
    extra?: Record<string, any>;
    status?: string;
    notes?: string;
  }) {
    const acc = await this.prisma.trafficAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('引流账号不存在');
    // CS 只能改自己的；ADMIN/OWNER 可改工作室内的
    if (user.role === 'CS' || user.role === 'COMPANION') {
      if (acc.userId !== user.id) throw new ForbiddenException('只能操作自己的引流账号');
    } else if (user.studioId && acc.studioId !== user.studioId) {
      throw new ForbiddenException('无权操作其他工作室的账号');
    }
    const data: any = {};
    if (dto.type !== undefined) data.type = dto.type.trim();
    if (dto.code !== undefined) data.code = dto.code?.trim() || null;
    if (dto.trafficLevel !== undefined) data.trafficLevel = dto.trafficLevel?.trim() || null;
    if (dto.accountRole !== undefined) data.accountRole = dto.accountRole?.trim() || null;
    if (dto.accountStyle !== undefined) data.accountStyle = dto.accountStyle?.trim() || null;
    if (dto.nickname !== undefined) data.nickname = dto.nickname.trim();
    if (dto.accountId !== undefined) data.accountId = dto.accountId?.trim() || null;
    if (dto.wifi !== undefined) data.wifi = dto.wifi?.trim() || null;
    if (dto.wifiRegion !== undefined) data.wifiRegion = dto.wifiRegion?.trim() || null;
    if (dto.riskPopped !== undefined) data.riskPopped = dto.riskPopped?.trim() || null;
    if (dto.riskNote !== undefined) data.riskNote = dto.riskNote?.trim() || null;
    if (dto.banned !== undefined) data.banned = dto.banned?.trim() || null;
    if (dto.banNote !== undefined) data.banNote = dto.banNote?.trim() || null;
    if (dto.phone !== undefined) data.phone = dto.phone?.trim() || null;
    if (dto.promotionContact !== undefined) data.promotionContact = dto.promotionContact?.trim() || null;
    if (dto.realName !== undefined) data.realName = dto.realName?.trim() || null;
    if (dto.realNameAge !== undefined) data.realNameAge = dto.realNameAge != null ? Number(dto.realNameAge) : null;
    if (dto.realNameGender !== undefined) data.realNameGender = dto.realNameGender?.trim() || null;
    if (dto.followers !== undefined) data.followers = dto.followers != null ? Number(dto.followers) : null;
    if (dto.registerDate !== undefined) data.registerDate = dto.registerDate?.trim() || null;
    if (dto.banDate !== undefined) data.banDate = dto.banDate?.trim() || null;
    if (dto.imageSourceNote !== undefined) data.imageSourceNote = dto.imageSourceNote?.trim() || null;
    if (dto.imageFolder !== undefined) data.imageFolder = dto.imageFolder?.trim() || null;
    if (dto.otherNote !== undefined) data.otherNote = dto.otherNote?.trim() || null;
    if (dto.extra !== undefined) data.extra = dto.extra;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    return this.prisma.trafficAccount.update({ where: { id }, data });
  }

  async remove(user: any, id: string) {
    const acc = await this.prisma.trafficAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('引流账号不存在');
    if (user.role === 'CS' || user.role === 'COMPANION') {
      if (acc.userId !== user.id) throw new ForbiddenException('只能删除自己的引流账号');
    } else if (user.studioId && acc.studioId !== user.studioId) {
      throw new ForbiddenException('无权操作其他工作室的账号');
    }
    await this.prisma.trafficAccount.delete({ where: { id } });
    return { success: true };
  }

  // ── 笔记记录（小红书数据分析） ──

  private async assertAccountAccess(user: any, accountId: string) {
    const acc = await this.prisma.trafficAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new NotFoundException('引流账号不存在');
    if (user.role === 'CS' || user.role === 'COMPANION') {
      if (acc.userId !== user.id) throw new ForbiddenException('只能操作自己的引流账号');
    } else if (user.studioId && acc.studioId !== user.studioId) {
      throw new ForbiddenException('无权操作其他工作室的账号');
    }
    return acc;
  }

  /** 把「词/城市/兴趣」输入归一化成 [{ word|city|interest, ratio }]（去掉空项，限制条数）。 */
  private normalizeSearchItems(items: any, key: 'word' | 'city' | 'interest', max = 10): any[] {
    if (!Array.isArray(items)) return [];
    const cleaned = items
      .map((it: any) => {
        if (it == null) return null;
        const name = typeof it?.[key] === 'string' ? (it[key] as string).trim() : '';
        const ratio = it?.ratio != null && !Number.isNaN(Number(it.ratio)) ? Number(it.ratio) : null;
        return name ? { [key]: name, ratio } : null;
      })
      .filter((v: any) => v != null)
      .slice(0, max);
    return cleaned;
  }

  async listNotes(user: any, accountId: string) {
    const acc = await this.assertAccountAccess(user, accountId);
    const notes = await this.prisma.trafficNote.findMany({
      where: { accountId },
      orderBy: [{ publishDate: 'desc' }, { createdAt: 'desc' }],
    });
    return { account: { id: acc.id, nickname: acc.nickname, type: acc.type }, notes };
  }

  async createNote(user: any, accountId: string, dto: any) {
    const acc = await this.assertAccountAccess(user, accountId);
    const note = await this.prisma.trafficNote.create({
      data: {
        accountId,
        studioId: acc.studioId,
        publishDate: dto.publishDate ? new Date(dto.publishDate) : null,
        title: dto.title?.trim() || null,
        exposure: dto.exposure != null ? Number(dto.exposure) : null,
        views: dto.views != null ? Number(dto.views) : null,
        clickRate: dto.clickRate != null ? Number(dto.clickRate) : null,
        interactionRate: dto.interactionRate != null ? Number(dto.interactionRate) : null,
        followRatio: dto.followRatio != null ? Number(dto.followRatio) : null,
        dmRate: dto.dmRate != null ? Number(dto.dmRate) : null,
        readCompletionRate: dto.readCompletionRate != null ? Number(dto.readCompletionRate) : null,
        likes: dto.likes != null ? Number(dto.likes) : null,
        comments: dto.comments != null ? Number(dto.comments) : null,
        favorites: dto.favorites != null ? Number(dto.favorites) : null,
        homeRecommendRatio: dto.homeRecommendRatio != null ? Number(dto.homeRecommendRatio) : null,
        searchRatio: dto.searchRatio != null ? Number(dto.searchRatio) : null,
        profileRatio: dto.profileRatio != null ? Number(dto.profileRatio) : null,
        searchKeywords: this.normalizeSearchItems(dto.searchKeywords, 'word', 10),
        cityDist: this.normalizeSearchItems(dto.cityDist, 'city', 5),
        interests: this.normalizeSearchItems(dto.interests, 'interest', 2),
        note: dto.note?.trim() || null,
      },
    });
    return note;
  }

  async updateNote(user: any, noteId: string, dto: any) {
    const note = await this.prisma.trafficNote.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException('笔记记录不存在');
    await this.assertAccountAccess(user, note.accountId);
    const data: any = {};
    if (dto.publishDate !== undefined) data.publishDate = dto.publishDate ? new Date(dto.publishDate) : null;
    if (dto.title !== undefined) data.title = dto.title?.trim() || null;
    if (dto.exposure !== undefined) data.exposure = dto.exposure != null ? Number(dto.exposure) : null;
    if (dto.views !== undefined) data.views = dto.views != null ? Number(dto.views) : null;
    if (dto.clickRate !== undefined) data.clickRate = dto.clickRate != null ? Number(dto.clickRate) : null;
    if (dto.interactionRate !== undefined) data.interactionRate = dto.interactionRate != null ? Number(dto.interactionRate) : null;
    if (dto.followRatio !== undefined) data.followRatio = dto.followRatio != null ? Number(dto.followRatio) : null;
    if (dto.dmRate !== undefined) data.dmRate = dto.dmRate != null ? Number(dto.dmRate) : null;
    if (dto.readCompletionRate !== undefined) data.readCompletionRate = dto.readCompletionRate != null ? Number(dto.readCompletionRate) : null;
    if (dto.likes !== undefined) data.likes = dto.likes != null ? Number(dto.likes) : null;
    if (dto.comments !== undefined) data.comments = dto.comments != null ? Number(dto.comments) : null;
    if (dto.favorites !== undefined) data.favorites = dto.favorites != null ? Number(dto.favorites) : null;
    if (dto.homeRecommendRatio !== undefined) data.homeRecommendRatio = dto.homeRecommendRatio != null ? Number(dto.homeRecommendRatio) : null;
    if (dto.searchRatio !== undefined) data.searchRatio = dto.searchRatio != null ? Number(dto.searchRatio) : null;
    if (dto.profileRatio !== undefined) data.profileRatio = dto.profileRatio != null ? Number(dto.profileRatio) : null;
    if (dto.searchKeywords !== undefined) data.searchKeywords = this.normalizeSearchItems(dto.searchKeywords, 'word', 10);
    if (dto.cityDist !== undefined) data.cityDist = this.normalizeSearchItems(dto.cityDist, 'city', 5);
    if (dto.interests !== undefined) data.interests = this.normalizeSearchItems(dto.interests, 'interest', 2);
    if (dto.note !== undefined) data.note = dto.note?.trim() || null;
    return this.prisma.trafficNote.update({ where: { id: noteId }, data });
  }

  async removeNote(user: any, noteId: string) {
    const note = await this.prisma.trafficNote.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException('笔记记录不存在');
    await this.assertAccountAccess(user, note.accountId);
    await this.prisma.trafficNote.delete({ where: { id: noteId } });
    return { success: true };
  }

  /** 保存「打法指南」内容（客服/管理端可编辑）。老板写全站默认，店长写本店。 */
  async savePlayGuide(content?: string, actor?: { role?: string | null; studioId?: string | null }) {
    await saveConfigsByRole(this.prisma, actor ?? {}, { 'traffic.play_guide': content ?? '' });
    return { success: true };
  }

  async analyzeNotes(user: any, accountId: string) {
    const acc = await this.assertAccountAccess(user, accountId);
    const notes = await this.prisma.trafficNote.findMany({
      where: { accountId },
      orderBy: [{ publishDate: 'desc' }, { createdAt: 'desc' }],
    });
    const account = { id: acc.id, nickname: acc.nickname, type: acc.type };
    const withViews = notes.filter((n) => n.views != null);
    const totalViews = withViews.reduce((s, n) => s + (n.views || 0), 0);
    const totalExposure = notes.reduce((s, n) => s + (n.exposure || 0), 0);
    const totalLikes = notes.reduce((s, n) => s + (n.likes || 0), 0);
    const totalComments = notes.reduce((s, n) => s + (n.comments || 0), 0);
    const totalFavorites = notes.reduce((s, n) => s + (n.favorites || 0), 0);
    const homeRatios = notes.filter((n) => n.homeRecommendRatio != null).map((n) => n.homeRecommendRatio as number);
    const searchRatios = notes.filter((n) => n.searchRatio != null).map((n) => n.searchRatio as number);
    const profileRatios = notes.filter((n) => n.profileRatio != null).map((n) => n.profileRatio as number);
    const interactionRates = notes.filter((n) => n.interactionRate != null).map((n) => n.interactionRate as number);
    const followRates = notes.filter((n) => n.followRatio != null).map((n) => n.followRatio as number);
    const dmRates = notes.filter((n) => n.dmRate != null).map((n) => n.dmRate as number);
    const readCompletionRates = notes.filter((n) => n.readCompletionRate != null).map((n) => n.readCompletionRate as number);
    const avg = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
    const avgViews = withViews.length ? totalViews / withViews.length : 0;
    // 点击率：优先用后台直给的 clickRate，缺省时用 浏览/曝光 计算
    const ctrs = notes.map((n) => {
      if (n.clickRate != null) return n.clickRate as number;
      if (n.views != null && n.exposure != null && n.exposure > 0) return (n.views / n.exposure) * 100;
      return null;
    }).filter((v): v is number => v != null);
    const avgCtr = avg(ctrs);
    const avgInteractionRate = avg(interactionRates);
    const avgFollowRate = avg(followRates);
    const avgDmRate = avg(dmRates);
    const avgReadCompletionRate = avg(readCompletionRates);
    const benchmarks = await this.getBenchmarks(user?.studioId ?? null);
    const aggregateEval = this.evaluateNote({
      clickRate: avgCtr,
      interactionRate: avgInteractionRate,
      dmRate: avgDmRate,
      searchRatio: avg(searchRatios),
      profileRatio: avg(profileRatios),
      readCompletionRate: avgReadCompletionRate,
    }, benchmarks);
    const best = withViews.slice().sort((a, b) => (b.views || 0) - (a.views || 0))[0];
    const recent = notes.slice(0, 5);
    const recentTrend = recent.filter((n) => n.views != null).map((n) => n.views as number);

    const conclusions: string[] = [];
    if (notes.length === 0) {
      conclusions.push('该账号还没有录入任何笔记数据，先录入笔记再生成分析。');
    } else {
      conclusions.push(`共记录 ${notes.length} 条笔记，总曝光 ${totalExposure}，总浏览量 ${totalViews}，平均单篇浏览量 ${avgViews.toFixed(0)}。`);
      if (best?.title) conclusions.push(`表现最好的笔记是「${best.title}」，浏览量 ${best.views}，可作为内容模板参考。`);
      const homeAvg = avg(homeRatios);
      const searchAvg = avg(searchRatios);
      const profileAvg = avg(profileRatios);
      conclusions.push(`首页推荐占比均值 ${homeAvg.toFixed(1)}%，搜索占比均值 ${searchAvg.toFixed(1)}%，个人主页占比均值 ${profileAvg.toFixed(1)}%。`);
      if (homeAvg > searchAvg) conclusions.push('该账号以主页推荐流量为主，适合做账号人设/主页承接转化。');
      else if (searchAvg > homeAvg) conclusions.push('该账号以搜索流量为主，建议围绕高搜索需求关键词做内容。');
      if (avgCtr > 0) conclusions.push(`平均点击率 ${avgCtr.toFixed(1)}%，${avgCtr < 5 ? '偏低，建议优化封面和标题' : avgCtr > 10 ? '表现优秀，封面标题有吸引力' : '处于正常区间'}。`);
      if (avgInteractionRate > 0) conclusions.push(`平均互动率 ${avgInteractionRate.toFixed(1)}%，${avgInteractionRate < 3 ? '偏低，建议加强内容价值或互动引导' : avgInteractionRate > 8 ? '表现优秀，内容很对用户胃口' : '处于正常区间'}。`);
      if (avgFollowRate > 0) conclusions.push(`平均涨粉率 ${avgFollowRate.toFixed(2)}%，${avgFollowRate < 0.1 ? '偏低，建议强化账号人设和主页承接' : '账号人设承接较好'}。`);
      if (avgDmRate > 0) conclusions.push(`平均私信率 ${avgDmRate.toFixed(2)}%，私信率越高说明引流承接越好。`);
      if (aggregateEval.length) {
        const bads = aggregateEval.filter((e) => e.level === 'red').map((e) => e.label);
        const goods = aggregateEval.filter((e) => e.level === 'blue').map((e) => e.label);
        if (bads.length) conclusions.push(`⚠️ 需要优先优化：${bads.join('、')}，具体改法见下方「判级明细」。`);
        else if (goods.length) conclusions.push(`✅ 表现突出：${goods.join('、')}，可复制这套模板铺量。`);
        else conclusions.push('核心指标整体在及格线以上，按 48 小时数据判断可继续铺量吃搜索长尾。');
      }
      if (recentTrend.length >= 2) {
        const up = recentTrend[0] > recentTrend[recentTrend.length - 1];
        conclusions.push(`最近 ${recentTrend.length} 条笔记浏览量呈${up ? '上升' : '下降或波动'}趋势，${up ? '可加大投入' : '建议调整选题方向'}。`);
      }
      conclusions.push(`累计点赞 ${totalLikes}、评论 ${totalComments}、收藏 ${totalFavorites}。`);
    }

    // AI 分析：基于账号运营信息 + 笔记数据 + 运营经验，调用 DeepSeek 生成建议。
    let aiAdvice = '';
    try {
      aiAdvice = await this.callAI(this.buildAIPrompt(acc, notes, {
        totalViews, avgViews, totalExposure, totalLikes, totalComments, totalFavorites,
        avgHomeRecommendRatio: avg(homeRatios), avgSearchRatio: avg(searchRatios), avgProfileRatio: avg(profileRatios),
        avgCtr, avgInteractionRate, avgFollowRate, avgDmRate,
      }));
    } catch {}

    return {
      account,
      summary: {
        noteCount: notes.length,
        totalExposure,
        totalViews,
        totalLikes,
        totalComments,
        totalFavorites,
        avgViews: Number(avgViews.toFixed(0)),
        avgCtr: Number(avgCtr.toFixed(1)),
        avgInteractionRate: Number(avgInteractionRate.toFixed(1)),
        avgFollowRate: Number(avgFollowRate.toFixed(2)),
        avgDmRate: Number(avgDmRate.toFixed(2)),
        avgHomeRecommendRatio: Number(avg(homeRatios).toFixed(1)),
        avgSearchRatio: Number(avg(searchRatios).toFixed(1)),
        avgProfileRatio: Number(avg(profileRatios).toFixed(1)),
        avgReadCompletionRate: Number(avgReadCompletionRate.toFixed(1)),
        bestNote: best ? { title: best.title, views: best.views, publishDate: best.publishDate } : null,
      },
      benchmarks,
      evaluation: aggregateEval,
      conclusions,
      aiAdvice,
      aiEnabled: Boolean(aiAdvice),
      generatedAt: new Date().toISOString(),
    };
  }

  /** 读取图文笔记及格线（动态阈值，默认来自豆包建议，可在后台「AI 分析」设置里修改）。 */
  private async getBenchmarks(studioId?: string | null): Promise<any> {
    const defaults = {
      clickRate: { eliminate: 2.5, pass: 4.5, good: 4.5 },
      interactionRate: { eliminate: 2, pass: 3.5, good: 3.5 },
      dmRate: { eliminate: 0.5, pass: 1.5, good: 3 },
      searchRatio: { min: 10, idealLow: 20, idealHigh: 40 },
      profileRatio: { ok: 10, warn: 20 },
      readCompletionRate: { min: 40 },
    };
    const scoped = await resolveConfigsRaw(this.prisma, studioId ?? null, [
      'traffic.note_benchmarks',
    ]).catch(() => ({}) as Record<string, any>);
    const v = scoped['traffic.note_benchmarks'] as any;
    if (v && typeof v === 'object') {
      return {
        clickRate: { ...defaults.clickRate, ...(v.clickRate || {}) },
        interactionRate: { ...defaults.interactionRate, ...(v.interactionRate || {}) },
        dmRate: { ...defaults.dmRate, ...(v.dmRate || {}) },
        searchRatio: { ...defaults.searchRatio, ...(v.searchRatio || {}) },
        profileRatio: { ...defaults.profileRatio, ...(v.profileRatio || {}) },
        readCompletionRate: { ...defaults.readCompletionRate, ...(v.readCompletionRate || {}) },
      };
    }
    return defaults;
  }

  /** 判级：给定一组笔记指标，返回每项指标的档次、颜色与改法提示。 */
  private evaluateNote(note: any, b: any): any[] {
    const n = (v: any) => (v == null || v === '' ? null : Number(v));
    const mk = (key: string, label: string, value: number | null, level: string, tier: string, hint: string) => ({ key, label, value, level, tier, hint });
    const out: any[] = [];

    const click = n(note.clickRate);
    if (click != null && Number.isFinite(click)) {
      if (click < b.clickRate.eliminate) out.push(mk('clickRate', '点击率', click, 'red', '淘汰', '封面标题无效，曝光不点。直接换封面+标题重做。'));
      else if (click < b.clickRate.pass) out.push(mk('clickRate', '点击率', click, 'orange', '及格', '矩阵常规水平，能吃少量搜索长尾，继续优化钩子。'));
      else if (click < b.clickRate.good) out.push(mk('clickRate', '点击率', click, 'green', '良好', '封面模板可批量复用到矩阵其他号。'));
      else out.push(mk('clickRate', '点击率', click, 'blue', '优质', '封面钩子强，重点复制这套模板。'));
    }

    const inter = n(note.interactionRate);
    if (inter != null && Number.isFinite(inter)) {
      if (inter < b.interactionRate.eliminate) out.push(mk('interactionRate', '互动率', inter, 'red', '淘汰', '几乎没有玩家共鸣，算法停推。加情绪/槽点。'));
      else if (inter < b.interactionRate.pass) out.push(mk('interactionRate', '互动率', inter, 'orange', '及格', '能跑基础流量，难放大。加吐槽/段位话题。'));
      else if (inter < b.interactionRate.good) out.push(mk('interactionRate', '互动率', inter, 'green', '良好', '玩家愿意留言，处于矩阵目标区间。'));
      else out.push(mk('interactionRate', '互动率', inter, 'blue', '优质', '容易进更大流量池，复制这套选题。'));
    }

    const dm = n(note.dmRate);
    if (dm != null && Number.isFinite(dm)) {
      if (dm < b.dmRate.eliminate) out.push(mk('dmRate', '私信率', dm, 'red', '淘汰', '几百浏览几乎0私信。优化转化钩子/私信引导。'));
      else if (dm < b.dmRate.pass) out.push(mk('dmRate', '私信率', dm, 'orange', '及格', '零星咨询，矩阵常态。'));
      else if (dm < b.dmRate.good) out.push(mk('dmRate', '私信率', dm, 'green', '良好', '同等浏览下私信明显变多。'));
      else out.push(mk('dmRate', '私信率', dm, 'blue', '优质', '搜索占比高的笔记才易达到，重点复制。'));
    }

    const search = n(note.searchRatio);
    if (search != null && Number.isFinite(search)) {
      if (search < b.searchRatio.min) out.push(mk('searchRatio', '搜索占比', search, 'red', '淘汰', '全是首页泛路人，浏览虚高咨询少。埋精准关键词。'));
      else if (search < b.searchRatio.idealLow) out.push(mk('searchRatio', '搜索占比', search, 'orange', '达标', '达到最低底线，继续埋关键词拉高。'));
      else out.push(mk('searchRatio', '搜索占比', search, 'green', '理想', '搜索占比理想，长尾流量稳。'));
    }

    const prof = n(note.profileRatio);
    if (prof != null && Number.isFinite(prof)) {
      if (prof > b.profileRatio.warn) out.push(mk('profileRatio', '个人主页占比', prof, 'red', '淘汰', '老用户回访占比过高，浏览虚高、新增意向少。'));
      else if (prof > b.profileRatio.ok) out.push(mk('profileRatio', '个人主页占比', prof, 'orange', '注意', '略有偏高，建议多拉新客曝光。'));
      else out.push(mk('profileRatio', '个人主页占比', prof, 'green', '达标', '新客来源健康。'));
    }

    const read = n(note.readCompletionRate);
    if (read != null && Number.isFinite(read)) {
      if (read < b.readCompletionRate.min) out.push(mk('readCompletionRate', '阅读完成率', read, 'red', '淘汰', '图片多/文字太长，用户划一半退出。精简到3-6张图、短文案。'));
      else out.push(mk('readCompletionRate', '阅读完成率', read, 'green', '达标', '阅读完成率健康，内容节奏合适。'));
    }

    return out;
  }

  /** 构造发给大模型的提示词，包含账号运营字段、笔记数据与运营经验规则。 */
  private buildAIPrompt(acc: any, notes: any[], stat: any): string {
    const fmtList = (items: any, key: string) => {
      if (!Array.isArray(items) || !items.length) return '-';
      return items.map((it: any) => {
        const name = it?.[key] ?? '';
        const ratio = it?.ratio != null ? `${it.ratio}%` : '';
        return ratio ? `${name}(${ratio})` : name;
      }).join('、');
    };
    const noteLines = notes.slice(0, 20).map((n, i) => {
      const d = n.publishDate ? new Date(n.publishDate).toISOString().slice(0, 10) : '-';
      return `${i + 1}. ${d} | 曝光${n.exposure ?? '-'} | 浏览${n.views ?? '-'} | 点击率${n.clickRate ?? '-'}% | 互动率${n.interactionRate ?? '-'}% | 涨粉率${n.followRatio ?? '-'}% | 私信率${n.dmRate ?? '-'}% | 赞${n.likes ?? '-'} | 评${n.comments ?? '-'} | 藏${n.favorites ?? '-'} | 首页推荐${n.homeRecommendRatio ?? '-'}% | 搜索${n.searchRatio ?? '-'}% | 个人主页${n.profileRatio ?? '-'}% | 热词:${fmtList(n.searchKeywords, 'word')} | 城市:${fmtList(n.cityDist, 'city')} | 兴趣:${fmtList(n.interests, 'interest')} | ${n.title || ''}`;
    }).join('\n');

    return `请根据以下小红书矩阵账号与笔记数据，给出简短的运营建议（分点，每条不超过一句话，直接给可执行动作）。

【账号信息】
平台：${acc.type || '-'}
昵称：${acc.nickname || '-'}
账号人设：${acc.accountRole || '-'}
流量等级：${acc.trafficLevel || '-'}
实名人：${acc.realName || '-'}（年龄 ${acc.realNameAge ?? '-'}，性别 ${acc.realNameGender ?? '-'}）
WiFi地区：${acc.wifiRegion || '-'}
粉丝数：${acc.followers ?? '-'}
注册日期：${acc.registerDate || '-'}
手机号：${acc.phone || '-'}

【笔记汇总】
笔记数：${notes.length}
总曝光：${stat.totalExposure}
总浏览：${stat.totalViews}
平均浏览：${stat.avgViews.toFixed(0)}
累计点赞：${stat.totalLikes}，评论：${stat.totalComments}，收藏：${stat.totalFavorites}
平均点击率：${stat.avgCtr.toFixed(1)}%
平均互动率：${stat.avgInteractionRate.toFixed(1)}%
平均涨粉率：${stat.avgFollowRate.toFixed(2)}%
平均私信率：${stat.avgDmRate.toFixed(2)}%
平均首页推荐占比：${stat.avgHomeRecommendRatio.toFixed(1)}%
平均搜索占比：${stat.avgSearchRatio.toFixed(1)}%
平均个人主页占比：${stat.avgProfileRatio.toFixed(1)}%

【近期笔记明细】
${noteLines || '（无笔记数据）'}

【运营经验参考】
- 实名人年龄越小，账号初始流量通常越好；
- WiFi地区对流量有影响（例如上海等一线城市流量质量通常更好）；
- 首页推荐占比高说明内容承接/人设做得好，搜索占比高说明关键词选题有效，个人主页占比高说明账号主页承接好；
- 点击率看封面+标题，互动率看内容价值，涨粉率看人设记忆点；
- 私信率高说明引流到私域（私信）的承接好；
- 搜索热词反映用户主动检索意图，城市分布和兴趣分布可用于判断受众画像和投放地区/选题方向；
- 流量等级优/中/差反映账号当前权重；
- 建议结合以上经验，指出该账号的优势、短板，以及下一步最该做的 1-3 件事。`;
  }

  /** 读取单个 SystemConfig 值（字符串，优先配置，其次同名环境变量）。 */
  private async getConfigValue(key: string, envKey?: string): Promise<string> {
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key } }).catch(() => null);
    const v = cfg?.value as any;
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (envKey && process.env[envKey]) return process.env[envKey] as string;
    return '';
  }

  /** 读取 AI 分析配置（服务商 + 各服务商 Key + 豆包模型名）。 */
  private async getAiConfig() {
    const provider = (await this.getConfigValue('ai.provider')) || 'doubao';
    const deepseekKey = await this.getConfigValue('ai.deepseek_api_key', 'DEEPSEEK_API_KEY');
    const doubaoKey = await this.getConfigValue('ai.doubao_api_key', 'DOUBAO_API_KEY');
    const doubaoModel = (await this.getConfigValue('ai.doubao_model')) || 'doubao-pro-32k';
    return { provider, deepseekKey, doubaoKey, doubaoModel };
  }

  /** 按配置的服务商调用大模型，失败返回空字符串（前端回退到规则版结论）。 */
  private async callAI(prompt: string): Promise<string> {
    const { provider, deepseekKey, doubaoKey, doubaoModel } = await this.getAiConfig();
    let endpoint = '';
    let apiKey = '';
    let model = '';
    if (provider === 'doubao') {
      apiKey = doubaoKey;
      model = doubaoModel;
      endpoint = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
    } else if (provider === 'deepseek') {
      apiKey = deepseekKey;
      model = 'deepseek-chat';
      endpoint = 'https://api.deepseek.com/chat/completions';
    } else {
      return ''; // off / 未配置 → 走规则版结论
    }
    if (!apiKey) return '';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是小红书矩阵运营专家，输出简洁、可执行的运营建议，用中文。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1200,
      }),
    });
    if (!res.ok) return '';
    const json: any = await res.json();
    return json?.choices?.[0]?.message?.content || '';
  }

  /** 读取图片识别（豆包视觉）配置。 */
  private async getVisionConfig() {
    const apiKey = await this.getConfigValue('ai.doubao_api_key', 'DOUBAO_API_KEY');
    const model = (await this.getConfigValue('ai.doubao_vision_model')) || 'Doubao-1.5-vision-pro';
    return { apiKey, model };
  }

  /** 从笔记数据截图里识别出结构化字段（豆包视觉模型）。 */
  async recognizeNoteScreenshot(imageBase64: string, mimeType?: string) {
    const { apiKey, model } = await this.getVisionConfig();
    if (!apiKey) throw new ForbiddenException('未配置豆包 API Key，无法识别图片');
    const mime = mimeType || 'image/png';
    const prompt = `你是小红书笔记数据识别助手。请从这张截图里读出以下字段，只返回一个 JSON 对象（不要 Markdown、不要解释、不要多余文字），字段名固定如下，读不到或截图里没有的字段用 null：
{"title":"...","exposure":数字,"views":数字,"clickRate":数字(%),"interactionRate":数字(%),"followRatio":数字(%),"dmRate":数字(%),"likes":数字,"comments":数字,"favorites":数字,"homeRecommendRatio":数字(%),"searchRatio":数字(%),"profileRatio":数字(%)}
注意：曝光量=展示次数，浏览量/阅读量=点进详情次数；如果截图里的“互动数”只给了总数、没有拆出点赞/评论/收藏，那这些字段填 null，不要瞎编。`;
    const res = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 1000,
      }),
    });
    if (!res.ok) throw new Error(`图片识别失败（HTTP ${res.status}）`);
    const json: any = await res.json();
    const content = json?.choices?.[0]?.message?.content || '';
    return this.sanitizeRecognized(this.parseJsonFromText(content));
  }

  /** 从模型文本里提取 JSON（兼容被 ```json 围栏包裹的情况）。 */
  private parseJsonFromText(text: string): any {
    if (!text) return {};
    let t = text.trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    try { return JSON.parse(t); } catch {}
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(t.slice(start, end + 1)); } catch {}
    }
    return {};
  }

  /** 把识别结果里的数值字段统一转成 number 或 null，防止脏数据。 */
  private sanitizeRecognized(raw: any): any {
    const out: any = {};
    if (raw?.title != null && String(raw.title).trim()) out.title = String(raw.title).trim();
    const numericKeys = ['exposure', 'views', 'clickRate', 'interactionRate', 'followRatio', 'dmRate', 'likes', 'comments', 'favorites', 'homeRecommendRatio', 'searchRatio', 'profileRatio'];
    for (const k of numericKeys) {
      const v = raw?.[k];
      if (v === null || v === undefined || v === '') { out[k] = null; continue; }
      const n = Number(String(v).replace(/[%,\s]/g, ''));
      out[k] = Number.isFinite(n) ? n : null;
    }
    return out;
  }
}
