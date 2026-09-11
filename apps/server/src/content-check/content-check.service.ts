import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  exportLexicon,
  LEXICON_RULES,
  LEXICON_REGEX_RULES,
  LEXICON_VERSION,
  RiskLevel,
} from './content-check.lexicon';
import { CONTENT_PLAN_TEMPLATES } from './content-plan.templates';
import { CONTENT_KEYWORDS } from './content-keywords';

interface DraftInput {
  id?: string;
  title?: string;
  body?: string;
}

interface CheckInput {
  title?: string;
  body?: string;
  tags?: string[];
  drafts?: DraftInput[];
  historyTexts?: string[];
  includeStoredNotes?: boolean;
  useSemantic?: boolean;
}

interface MatchItem {
  ruleId: string;
  category: string;
  level: RiskLevel;
  matched: string;
  suggestion: string;
}

interface SimilarityItem {
  sourceId: string;
  sourceLabel: string;
  targetId: string;
  targetLabel: string;
  titleSimilarity: number;
  bodySimilarity: number;
  level: RiskLevel | 'none';
}

@Injectable()
export class ContentCheckService {
  constructor(private readonly prisma: PrismaService) {}

  getLexicon() {
    return exportLexicon();
  }

  async generatePlan(count = 30, mode = 'weekly', useAi = false, customKeywords: string[] = []) {
    if (useAi && mode === 'daily') {
      const dualPlan = await this.generateDualModelDailyPlan(count, '', customKeywords);
      if (dualPlan) return dualPlan;
      const aiPlan = await this.generateAiDailyPlan(count, customKeywords);
      if (aiPlan) return aiPlan;
    }
    return this.generateWeeklyPlan(count, mode, customKeywords);
  }

  async generateBenchmarkAnalysis(notes: any[] = []) {
    if (!Array.isArray(notes) || notes.length < 3) {
      throw new BadRequestException('请至少粘贴 3 条对标笔记');
    }

    const { deepseekKey, doubaoModel } = await this.getAiConfig();
    const seenNoteKeys = new Set<string>();
    const cleanNotes = notes
      .map((n) => ({
        title: String(n?.title || '').trim(),
        body: String(n?.body || n?.content || '').trim(),
        cover: String(n?.cover || '').trim(),
        noteUrl: String(n?.noteUrl || '').trim(),
        searchKeyword: String(n?.searchKeyword || '').trim(),
      }))
      .filter((n) => {
        if (!n.title && !n.body) return false;
        const key = n.noteUrl || `${n.title}|${n.body}`;
        if (seenNoteKeys.has(key)) return false;
        seenNoteKeys.add(key);
        return true;
      })
      .slice(0, 50);

    if (cleanNotes.length < 3) {
      throw new BadRequestException('对标笔记内容不完整，请确认 JSON 里包含标题或正文');
    }

    let benchmarkAnalysis: any = null;
    let benchmarkSummary = '';
    if (deepseekKey) {
      const prompt = `请拆解下面这些小红书笔记，总结这个赛道容易吸引点击和互动的规律。只返回一个 JSON 对象，不要 Markdown，字段固定如下：
{"titleFormulas":["标题公式1","标题公式2"],"openingHooks":["开头钩子1","开头钩子2"],"bodyStructure":["正文结构1","正文结构2"],"coverFeatures":["封面特点1","封面特点2"],"topics":["话题建议1","话题建议2"],"suggestions":["下一步建议1","下一步建议2"],"keywords":["建议账号主攻的长尾词1","长尾词2"]}

笔记：
${cleanNotes
  .map(
    (n, i) => `${i + 1}. 对应长尾词：${n.searchKeyword || '未标记'}\n标题：${n.title || '无'}\n正文：${n.body.slice(0, 1200)}\n封面：${n.cover || '无'}`,
  )
  .join('\n\n')}`;
      const raw = await this.callPlanModel('deepseek', deepseekKey, doubaoModel, prompt).catch(() => '');
      benchmarkAnalysis = this.parseJsonFromText(raw);
      if (benchmarkAnalysis) {
        benchmarkSummary = [
          benchmarkAnalysis.titleFormulas?.length ? `标题公式：${benchmarkAnalysis.titleFormulas.join('；')}` : '',
          benchmarkAnalysis.openingHooks?.length ? `开头钩子：${benchmarkAnalysis.openingHooks.join('；')}` : '',
          benchmarkAnalysis.bodyStructure?.length ? `正文结构：${benchmarkAnalysis.bodyStructure.join('；')}` : '',
          benchmarkAnalysis.coverFeatures?.length ? `封面特点：${benchmarkAnalysis.coverFeatures.join('；')}` : '',
          benchmarkAnalysis.topics?.length ? `话题选择：${benchmarkAnalysis.topics.join('；')}` : '',
          benchmarkAnalysis.suggestions?.length ? `下一步建议：${benchmarkAnalysis.suggestions.join('；')}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      }
    }

    if (!benchmarkSummary) {
      benchmarkSummary = cleanNotes
        .map((n) => `标题：${n.title || '无'}；正文：${n.body.slice(0, 500)}`)
        .join('\n');
    }

    const recommendedKeywords = Array.isArray(benchmarkAnalysis?.keywords)
      ? benchmarkAnalysis.keywords.map((k: any) => String(k || '').trim()).filter(Boolean).slice(0, 30)
      : [];

    return {
      benchmarkSummary,
      benchmarkAnalysis,
      recommendedKeywords,
      noteCount: cleanNotes.length,
    };
  }

  async generateBenchmarkPlan(
    count = 30,
    notes: any[] = [],
    customKeywords: string[] = [],
    benchmarkSummary = '',
  ) {
    if (!benchmarkSummary) {
      const analysis = await this.generateBenchmarkAnalysis(notes);
      benchmarkSummary = analysis.benchmarkSummary;
    }

    const plan =
      (await this.generateDualModelDailyPlan(count, benchmarkSummary, customKeywords)) ||
      (await this.generateAiDailyPlan(count, customKeywords)) ||
      this.generateDailyPlan(count, customKeywords);

    return {
      benchmarkSummary,
      plan,
    };
  }

  async rewritePlanRow(dto: {
    title?: string;
    body?: string;
    topics?: string;
    persona?: string;
    mode?: string;
    keyword?: string;
    day?: string;
    instruction?: string;
  }) {
    const { deepseekKey, doubaoKey, doubaoModel } = await this.getAiConfig();
    if (!deepseekKey && !doubaoKey) {
      throw new BadRequestException('未配置 DeepSeek 或豆包 API Key，无法重写');
    }

    const persona = dto.persona || '自然、真实、会聊天';
    const mode = dto.mode || '机密';
    const keyword = dto.keyword || '散陪';
    const day = dto.day || '周一';
    const originalTitle = dto.title || '';
    const originalBody = dto.body || '';
    const originalTopics = dto.topics || '#三角洲行动 #游戏日常 #游戏搭子';
    const instruction = dto.instruction?.trim() || '更自然、更真实、更口语化';

    let structure = '';
    if (deepseekKey) {
      const structurePrompt = `你是小红书内容策划。请根据下面的内容，生成一个新的内容角度和正文要点，只返回 JSON 对象：
{"angle":"内容角度","bodyPoints":"正文要点，用分号隔开"}

人设：${persona}
游戏：三角洲行动
模式：${mode}
关键词：${keyword}
星期：${day}
原标题：${originalTitle}
原正文：${originalBody}
修改要求：${instruction}`;
      structure = await this.callPlanModel('deepseek', deepseekKey, doubaoModel, structurePrompt).catch(() => '');
    }

    let structureParsed: any = {};
    if (structure) structureParsed = this.parseJsonFromText(structure) || {};
    const angle = typeof structureParsed?.angle === 'string' ? structureParsed.angle : '';
    const bodyPoints = typeof structureParsed?.bodyPoints === 'string' ? structureParsed.bodyPoints : '';

    const copyPrompt = `请重写下面这条小红书笔记，只返回一个 JSON 对象：
{"title":"标题","body":"正文","topics":["话题1","话题2","话题3"],"coverPlan":"封面构图建议","imagePlan":"配图建议"}

人设：${persona}
游戏：三角洲行动
模式：${mode}
关键词：${keyword}
星期：${day}
原标题：${originalTitle}
原正文：${originalBody}
原话题：${originalTopics}
修改要求：${instruction}
新内容角度：${angle || '保持原方向'}
新正文要点：${bodyPoints || '结合真实过程，突出双排配合、技术、不掉物资、情绪价值'}

要求：
1. 标题不超过20字；是否使用“散陪/个人陪”根据内容自然决定，最多一次；不要用“三角洲”开头，尽量用数字、问题、场景、对话或反差。
2. 正文150—220字，分2—3个自然小段，像真人聊天，要有具体场景、对话或一个小细节，不要只列卖点。
3. 不出现：微信、VX、威信、二维码、扫码、私信我、私我、加我、主页加我、低价、秒通过、保证、零风险、谁懂啊、破防了、全款拿下。
4. 结尾自然引导到主页。
5. coverPlan 说明封面怎么构图；imagePlan 说明发几张、发什么图。
6. 话题只给3个。`;

    const provider = doubaoKey ? 'doubao' : 'deepseek';
    const apiKey = doubaoKey || deepseekKey;
    const raw = await this.callPlanModel(provider, apiKey, doubaoModel, copyPrompt).catch(() => '');
    const parsed = this.parseJsonFromText(raw);
    const title = typeof parsed?.title === 'string' ? parsed.title.trim() : '';
    const body = typeof parsed?.body === 'string' ? parsed.body.trim() : '';
    const topics = Array.isArray(parsed?.topics) && parsed.topics.length
      ? parsed.topics.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 3)
      : originalTopics.split(/\s+/).filter(Boolean);
    const coverPlan = typeof parsed?.coverPlan === 'string'
      ? parsed.coverPlan.trim()
      : this.coverPlanFor(day, title);
    const imagePlan = typeof parsed?.imagePlan === 'string'
      ? parsed.imagePlan.trim()
      : this.imagePlanFor(day);
    const check = title && body ? this.checkWords(title, body, topics) : { clean: false, red: [{ matched: '生成缺失' }], orange: [] };
    if (!check.clean) {
      throw new BadRequestException('重写结果未通过违禁词检查，请调整要求后再试');
    }

    return {
      title,
      body,
      topics: topics.join(' '),
      coverPlan,
      imagePlan,
      riskCheck: { clean: true, red: [], orange: [] },
      generatedBy: deepseekKey && doubaoKey ? 'dual-ai' : provider,
    };
  }

  async generateWeeklyPlan(count = 30, mode = 'weekly', customKeywords: string[] = []) {
    if (mode === 'daily') {
      return this.generateDailyPlan(count, customKeywords);
    }
    const safeCount = Math.max(1, Math.min(30, Number(count) || 30));
    const rows = CONTENT_PLAN_TEMPLATES.slice(0, safeCount).map((template) => {
      const check = this.checkWords(template.title, template.body, template.topics);
      const targetKeyword = this.keywordFor(template.index, customKeywords);
      return {
        ...template,
        targetKeyword,
        topics: template.topics.join(' '),
        coverPlan: this.coverPlanFor(['周一', '周二', '周三', '周四', '周五', '周六', '周日'][(template.index - 1) % 7], template.title),
        imagePlan: this.imagePlanFor(['周一', '周二', '周三', '周四', '周五', '周六', '周日'][(template.index - 1) % 7]),
        riskCheck: {
          clean: check.clean,
          red: check.red,
          orange: check.orange,
        },
      };
    });

    const duplicatePairs: any[] = [];
    const normalizedTitles = new Set<string>();
    for (const row of rows) {
      const titleKey = this.compactText(row.title);
      if (normalizedTitles.has(titleKey)) {
        duplicatePairs.push({ level: 'red', title: row.title, reason: '标题与其他模板重复' });
      } else {
        normalizedTitles.add(titleKey);
      }
    }

    return {
      version: '2026.09.08',
      generatedAt: new Date().toISOString(),
      requested: safeCount,
      returned: rows.length,
      rows,
      audit: {
        bannedWordCount: rows.filter((r) => !r.riskCheck.clean).length,
        duplicatePairs,
        clean: duplicatePairs.length === 0 && rows.every((r) => r.riskCheck.clean),
      },
    };
  }

  private deriveTitleTag(title: string): string {
    return title
      .replace(/^三角洲(?:绝密|机密)?(?:散陪|个人陪|双排散陪)?，?/, '')
      .replace(/^个人陪也接，/, '')
      .replace(/^散陪双人车，/, '')
      .replace(/^三角洲绝密撤离路线，/, '')
      .replace(/^三角洲机密撤离路线，/, '')
      .replace(/^三角洲绝密路线，/, '')
      .replace(/^三角洲机密怎么/, '')
      .replace(/^三角洲绝密撤离，/, '')
      .replace(/^三角洲个人陪怎么约，/, '')
      .replace(/^三角洲/, '')
      .trim() || title;
  }

  private keywordFor(index: number, customKeywords?: string[]): string {
    const list = Array.isArray(customKeywords)
      ? customKeywords.map((k) => String(k || '').trim()).filter(Boolean)
      : [];
    if (list.length) return list[(index - 1) % list.length];
    return CONTENT_KEYWORDS[(index - 1) % CONTENT_KEYWORDS.length];
  }

  private coverPlanFor(day: string, title: string): string {
    const shortTitle = title.length > 8 ? `${title.slice(0, 8)}…` : title;
    switch (day) {
      case '周一':
        return `用真实双排截图做底，左上角放账号风格标签，中间压标题「${shortTitle}」，底部放今日可约时段。`;
      case '周二':
        return `用路线/地图截图做封面，左上角写模式，中间放路线名，标题压在图下方。`;
      case '周三':
        return `用结算图做封面，中间写「掉落都归你」或标题，下面放小字可约时段。`;
      case '周四':
        return `用真实结算数据图做主图，标题写「撤离率 / 复盘」，数据尽量露出但别遮挡。`;
      case '周五':
        return `用聊天片段或双排截图做底，标题用自然短句，不要放太多文字。`;
      case '周六':
        return `用直播精彩瞬间截图做封面，标题写「今晚双排」，下方写直播时间。`;
      case '周日':
        return `用问答文字图做封面，标题写「怎么约」，下面放3个高频问题。`;
      default:
        return `用真实对局截图做封面，标题压中间，字数少一点。`;
    }
  }

  private imagePlanFor(day: string): string {
    switch (day) {
      case '周一':
        return '发4张：1张封面结算图，2张双排过程图，1张可约时段文字图。';
      case '周二':
        return '发4张：1张路线封面，2张地图/点位截图，1张路线结论图。';
      case '周三':
        return '发4张：1张结算图，1张物资分配截图，1张理包前后图，1张可约时段图。';
      case '周四':
        return '发3张：2张结算数据图，1张复盘结论文字图。';
      case '周五':
        return '发4张：1张聊天截图，2张双排过程图，1张情绪/互动截图。';
      case '周六':
        return '发1条15—30秒录屏切片，再配1张直播预告图。';
      case '周日':
        return '发4张：1张问答封面，3张问答文字图。';
      default:
        return '发3—4张真实对局截图，尽量包含结算图、过程图和可约时段图。';
    }
  }

  private generateDailyPlan(count = 30, customKeywords: string[] = []) {
    const safeCount = Math.max(1, Math.min(30, Number(count) || 30));
    const timeSlots = ['08:00', '09:30', '11:00', '13:30', '15:00', '16:30', '18:00', '19:30', '21:00', '23:00'];
    const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const rows: any[] = [];
    const seenTitles = new Set<string>();

    for (const base of CONTENT_PLAN_TEMPLATES.slice(0, safeCount)) {
      const titleTag = this.deriveTitleTag(base.title);
      const keyword = base.title.includes('个人陪') ? '个人陪' : '散陪';
      const mode = base.title.includes('绝密') ? '绝密' : '机密';
      const targetKeyword = this.keywordFor(base.index, customKeywords);
      const dayFrames = [
        {
          day: days[0],
          title: base.title,
          body: `${base.persona}，平时打${mode}比较多。我们两个人一个看前点，一个补枪，掉出来的东西不碰，都留给老板。有卡会开卡，包也会帮你理。今天有空，主页问一句。`,
          topics: base.topics,
          coverPlan: this.coverPlanFor(days[0], base.title),
          imagePlan: this.imagePlanFor(days[0]),
        },
        {
          day: days[1],
          title: `${titleTag}，${mode}路线这样走`,
          body: `今天讲一条我常走的${mode}路线。${base.persona}，报点会讲清楚，哪里能进、哪里容易翻车，都会提前说。打的时候不抢你的东西，你就跟着走。想看具体路线，主页问一句。`,
          topics: ['#三角洲行动', '#三角洲攻略', '#游戏日常'],
          coverPlan: this.coverPlanFor(days[1], `${titleTag}，${mode}路线这样走`),
          imagePlan: this.imagePlanFor(days[1]),
        },
        {
          day: days[2],
          title: `${titleTag}，掉落都归你`,
          body: `接${keyword}，我们打法比较稳。有卡会开卡，包里东西也会帮你理，掉出来的物资不碰，全部留给你。你不用急着捡，我们掩护。今天有空，想一起打的话主页问一句。`,
          topics: ['#三角洲行动', '#游戏攻略', '#理包'],
          coverPlan: this.coverPlanFor(days[2], `${titleTag}，掉落都归你`),
          imagePlan: this.imagePlanFor(days[2]),
        },
        {
          day: days[3],
          title: `${titleTag}，${mode}复盘`,
          body: `复盘一把${mode}。${base.persona}，前点补枪怎么配合，中间哪个点差点出事，最后为什么能撤，都写清楚。我们不会夸大，只讲真实过程。今晚有空，主页问一句。`,
          topics: ['#三角洲行动', '#战绩', '#游戏日常'],
          coverPlan: this.coverPlanFor(days[3], `${titleTag}，${mode}复盘`),
          imagePlan: this.imagePlanFor(days[3]),
        },
        {
          day: days[4],
          title: `${titleTag}，边打边聊`,
          body: `打${mode}的时候我不闷，会一直跟你聊。${base.persona}，输赢都不甩锅，你打得不好我也能慢慢带。东西我们不碰，掉出来全给你。今天有空，主页问一句。`,
          topics: ['#三角洲行动', '#游戏搭子', '#女玩家'],
          coverPlan: this.coverPlanFor(days[4], `${titleTag}，边打边聊`),
          imagePlan: this.imagePlanFor(days[4]),
        },
        {
          day: days[5],
          title: `今晚双排，${titleTag}`,
          body: `今晚${mode}双排，${base.persona}，一个人看前点，一个人补枪，节奏比单排稳一点。不会让你一直紧张，边打边聊。今晚有空的话，主页问一句。`,
          topics: ['#三角洲行动', '#双排', '#游戏日常'],
          coverPlan: this.coverPlanFor(days[5], `今晚双排，${titleTag}`),
          imagePlan: this.imagePlanFor(days[5]),
        },
        {
          day: days[6],
          title: `怎么约，${titleTag}`,
          body: `最近问得多的几个问题一起说清。${keyword}、${mode}都能打，有卡会开卡，掉落不碰。可约时段我写在主页了，你不用先留别的信息，主页问一句就行。`,
          topics: ['#三角洲行动', '#游戏日常', '#游戏搭子'],
          coverPlan: this.coverPlanFor(days[6], `怎么约，${titleTag}`),
          imagePlan: this.imagePlanFor(days[6]),
        },
      ];

      dayFrames.forEach((frame, dayIndex) => {
        const time = timeSlots[(base.index - 1 + dayIndex) % timeSlots.length];
        const check = this.checkWords(frame.title, frame.body, frame.topics);
        const titleKey = this.compactText(frame.title);
        if (!seenTitles.has(titleKey)) {
          seenTitles.add(titleKey);
        }
        rows.push({
          index: rows.length + 1,
          accountNo: base.index,
          targetKeyword,
          day: frame.day,
          persona: base.persona,
          suggestedTime: `${frame.day} ${time}`,
          title: frame.title,
          body: frame.body,
          topics: frame.topics.join(' '),
          coverPlan: frame.coverPlan,
          imagePlan: frame.imagePlan,
          riskCheck: {
            clean: check.clean,
            red: check.red,
            orange: check.orange,
          },
        });
      });
    }

    const duplicatePairs: any[] = [];
    const titleCounts = new Map<string, number>();
    for (const row of rows) {
      const key = this.compactText(row.title);
      titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
    }
    for (const [title, count] of titleCounts) {
      if (count > 1) duplicatePairs.push({ level: 'red', title, reason: `标题出现 ${count} 次` });
    }

    return {
      version: '2026.09.08',
      generatedAt: new Date().toISOString(),
      mode: 'daily',
      requestedAccounts: safeCount,
      requestedDays: 7,
      returned: rows.length,
      rows,
      audit: {
        bannedWordCount: rows.filter((r) => !r.riskCheck.clean).length,
        duplicatePairs,
        clean: duplicatePairs.length === 0 && rows.every((r) => r.riskCheck.clean),
      },
    };
  }

  private async callPlanModel(provider: string, apiKey: string, doubaoModel: string, prompt: string): Promise<string> {
    let endpoint = '';
    let model = '';
    if (provider === 'deepseek') {
      endpoint = 'https://api.deepseek.com/chat/completions';
      model = 'deepseek-chat';
    } else {
      endpoint = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
      model = doubaoModel;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是小红书游戏陪玩内容写手，只输出 JSON 数组，不要解释。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
        max_tokens: 2400,
      }),
    });

    if (!res.ok) return '';
    const json: any = await res.json();
    return json?.choices?.[0]?.message?.content || '';
  }

  private async generateAiDailyPlan(count = 30, customKeywords: string[] = []) {
    const { deepseekKey, doubaoKey, doubaoModel } = await this.getAiConfig();
    const provider = deepseekKey ? 'deepseek' : 'doubao';
    const apiKey = deepseekKey || doubaoKey;
    if (!apiKey) return null;

    const fallback = this.generateDailyPlan(count, customKeywords);
    const fallbackByKey = new Map<string, any>(
      fallback.rows.map((r) => [`${r.accountNo}-${r.day}`, r]),
    );

    const rows: any[] = [];
    for (const base of CONTENT_PLAN_TEMPLATES.slice(0, Math.max(1, Math.min(30, Number(count) || 30)))) {
      const keyword = base.title.includes('个人陪') ? '个人陪' : '散陪';
      const mode = base.title.includes('绝密') ? '绝密' : '机密';
      const targetKeyword = this.keywordFor(base.index, customKeywords);
      const prompt = `请根据下面的人设生成 7 天小红书内容，每天一条，只返回 JSON 数组。

人设：${base.persona}
主推游戏：三角洲行动
擅长模式：${mode}
服务关键词：${keyword}
本周核心长尾词：${targetKeyword}
本周建议时间参考：${base.suggestedTime}

每条 JSON 字段固定为：
{"day":"周一|周二|周三|周四|周五|周六|周日","title":"标题","body":"正文","topics":["话题1","话题2","话题3"],"coverPlan":"封面构图建议","imagePlan":"配图建议"}

必须遵守：
1. 标题不超过20字；7天里最多2天标题包含“散陪”或“个人陪”；不要每天以“三角洲”开头，用数字、问题、场景、对话、反差等不同结构。
2. 正文150—220字，分2—3个自然小段，像真人聊天，要有具体场景、对话或一个小细节，不要只列卖点。
3. 标题、正文、话题必须统一围绕「本周核心长尾词」展开；标题前部自然包含或贴近该词，正文前100字自然提到，话题至少1个相关。
3. 不出现：微信、VX、威信、二维码、扫码、私信我、私我、加我、主页加我、低价、秒通过、保证、零风险、谁懂啊、破防了、全款拿下。
4. 七天内容角度要不同：自我介绍、攻略、服务说明、战绩复盘、聊天日常、直播切片、答疑预约。
5. 结尾自然引导到主页，例如“主页问一句”。
6. coverPlan 说明封面怎么构图；imagePlan 说明发几张、发什么图。
7. 话题只给3个。`;

      const raw = await this.callPlanModel(provider, apiKey, doubaoModel, prompt).catch(() => '');
      const parsed = this.parseJsonFromText(raw);
      const items = Array.isArray(parsed) ? parsed.slice(0, 7) : [];

      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const local = fallback.rows.find((r) => r.accountNo === base.index && r.day === ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][dayIndex]);
        const item = items[dayIndex] || {};
        const title = typeof item?.title === 'string' ? item.title.trim() : '';
        const body = typeof item?.body === 'string' ? item.body.trim() : '';
        const topics = Array.isArray(item?.topics) && item.topics.length
          ? item.topics.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 3)
          : (local?.topics?.split(' ') || ['#三角洲行动', '#游戏日常', '#游戏搭子']);
        const coverPlan = typeof item?.coverPlan === 'string' ? item.coverPlan.trim() : local?.coverPlan || this.coverPlanFor(local?.day || '周一', title);
        const imagePlan = typeof item?.imagePlan === 'string' ? item.imagePlan.trim() : local?.imagePlan || this.imagePlanFor(local?.day || '周一');
        const check = title && body ? this.checkWords(title, body, topics) : { clean: false, red: [{ matched: '生成缺失' }], orange: [] };
        const useAi = Boolean(title && body && check.clean);

        rows.push({
          index: rows.length + 1,
          accountNo: base.index,
          targetKeyword,
          day: local?.day || ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][dayIndex],
          persona: base.persona,
          suggestedTime: local?.suggestedTime || '',
          title: useAi ? title : local?.title || title || '待补充',
          body: useAi ? body : local?.body || body || '待补充',
          topics: (useAi ? topics : (local?.topics?.split(' ') || topics)).join(' '),
          coverPlan,
          imagePlan,
          riskCheck: useAi ? { clean: true, red: [], orange: [] } : local?.riskCheck || { clean: false, red: [], orange: [] },
          generatedBy: useAi ? 'ai' : 'fallback',
        });
      }
    }

    // 标题去重：如果 AI 生成出现重复，就回退到本地安全模板。
    const seenTitles = new Set<string>();
    for (let i = 0; i < rows.length; i += 1) {
      const key = this.compactText(rows[i].title);
      if (seenTitles.has(key)) {
        const fb = fallbackByKey.get(`${rows[i].accountNo}-${rows[i].day}`);
        if (fb && !seenTitles.has(this.compactText(fb.title))) {
          rows[i] = {
            ...fb,
            index: rows[i].index,
            generatedBy: 'fallback',
          };
          seenTitles.add(this.compactText(fb.title));
        }
      } else {
        seenTitles.add(key);
      }
    }

    const titleCounts = new Map<string, number>();
    for (const row of rows) {
      const key = this.compactText(row.title);
      titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
    }
    const duplicatePairs: any[] = [];
    for (const [title, count] of titleCounts) {
      if (count > 1) duplicatePairs.push({ level: 'red', title, reason: `标题出现 ${count} 次` });
    }

    return {
      version: '2026.09.08',
      generatedAt: new Date().toISOString(),
      mode: 'daily',
      generatedBy: 'ai',
      requestedAccounts: rows.length ? Math.max(...rows.map((r) => r.accountNo)) : 0,
      requestedDays: 7,
      returned: rows.length,
      rows,
      audit: {
        bannedWordCount: rows.filter((r) => !r.riskCheck?.clean).length,
        duplicatePairs,
        clean: duplicatePairs.length === 0 && rows.every((r) => r.riskCheck?.clean),
      },
    };
  }

  private async generateDualModelDailyPlan(count = 30, benchmarkSummary = '', customKeywords: string[] = []) {
    const { deepseekKey, doubaoKey, doubaoModel } = await this.getAiConfig();
    if (!deepseekKey || !doubaoKey) return null;

    const safeCount = Math.max(1, Math.min(30, Number(count) || 30));
    const fallback = this.generateDailyPlan(safeCount, customKeywords);
    const fallbackByKey = new Map<string, any>(
      fallback.rows.map((r) => [`${r.accountNo}-${r.day}`, r]),
    );

    const rows: any[] = [];
    for (const base of CONTENT_PLAN_TEMPLATES.slice(0, safeCount)) {
      const keyword = base.title.includes('个人陪') ? '个人陪' : '散陪';
      const mode = base.title.includes('绝密') ? '绝密' : '机密';
      const targetKeyword = this.keywordFor(base.index, customKeywords);

      const structurePrompt = `你是小红书内容策划。请为下面这个账号规划一周 7 天内容，只返回 JSON 数组。

账号人设：${base.persona}
游戏：三角洲行动
擅长模式：${mode}
服务关键词：${keyword}
本周核心长尾词：${targetKeyword}
本周参考时间：${base.suggestedTime}
对标爆款规律：${benchmarkSummary || '无，按自然、真实、口语化处理'}

每天返回字段：
{"day":"周一|周二|周三|周四|周五|周六|周日","angle":"内容角度","titleHint":"标题方向","bodyPoints":"正文要点，用分号隔开","topics":["话题1","话题2","话题3"]}

7天角度要覆盖：自我介绍、攻略、服务说明、战绩复盘、聊天日常、直播切片、答疑预约。`;

      const structureRaw = await this.callPlanModel('deepseek', deepseekKey, doubaoModel, structurePrompt).catch(() => '');
      const structureParsed = this.parseJsonFromText(structureRaw);
      const structures = Array.isArray(structureParsed) ? structureParsed.slice(0, 7) : [];

      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const dayName = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][dayIndex];
        const local = fallback.rows.find((r) => r.accountNo === base.index && r.day === dayName);
        const structure = structures[dayIndex] || {};
        const angle = typeof structure?.angle === 'string' ? structure.angle : '';
        const titleHint = typeof structure?.titleHint === 'string' ? structure.titleHint : '';
        const bodyPoints = typeof structure?.bodyPoints === 'string' ? structure.bodyPoints : '';
        const structureTopics = Array.isArray(structure?.topics) ? structure.topics : [];

        const copyPrompt = `请根据下面的结构写一条小红书笔记，只返回一个 JSON 对象：
{"title":"标题","body":"正文","topics":["话题1","话题2","话题3"],"coverPlan":"封面构图建议","imagePlan":"配图建议"}

账号人设：${base.persona}
游戏：三角洲行动
擅长模式：${mode}
服务关键词：${keyword}
星期：${dayName}
核心长尾词：${targetKeyword}
内容角度：${angle || '自然日常'}
标题方向：${titleHint || '自然、具体、不超过20字'}
正文要点：${bodyPoints || '结合真实游戏过程，突出双排配合、技术、不掉物资、情绪价值'}
话题方向：${structureTopics.join('、') || '#三角洲行动 #游戏日常 #游戏搭子'}
对标爆款规律：${benchmarkSummary || '无，按自然、真实、口语化处理'}

要求：
1. 标题不超过20字；这一条是否使用“散陪/个人陪”由你根据内容角度决定，最多一天一次，不要硬塞；不要用“三角洲”开头，尽量用数字、问题、场景、对话或反差。
2. 正文150—220字，分2—3个自然小段，像真人聊天，要有具体场景、对话或一个小细节，不要只列卖点。
3. 标题、正文、话题必须统一围绕「核心长尾词」展开；标题前部自然包含或贴近该词，正文前100字自然提到，话题至少1个相关。
3. 不出现：微信、VX、威信、二维码、扫码、私信我、私我、加我、主页加我、低价、秒通过、保证、零风险、谁懂啊、破防了、全款拿下。
4. 结尾自然引导到主页，例如“主页问一句”。
5. coverPlan 说明封面怎么构图；imagePlan 说明发几张、发什么图。
6. 话题只给3个。`;

        const copyRaw = await this.callPlanModel('doubao', doubaoKey, doubaoModel, copyPrompt).catch(() => '');
        const copyParsed = this.parseJsonFromText(copyRaw);
        const title = typeof copyParsed?.title === 'string' ? copyParsed.title.trim() : '';
        const body = typeof copyParsed?.body === 'string' ? copyParsed.body.trim() : '';
        const topics = Array.isArray(copyParsed?.topics) && copyParsed.topics.length
          ? copyParsed.topics.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 3)
          : (local?.topics?.split(' ') || ['#三角洲行动', '#游戏日常', '#游戏搭子']);
        const coverPlan = typeof copyParsed?.coverPlan === 'string' ? copyParsed.coverPlan.trim() : local?.coverPlan || this.coverPlanFor(dayName, title);
        const imagePlan = typeof copyParsed?.imagePlan === 'string' ? copyParsed.imagePlan.trim() : local?.imagePlan || this.imagePlanFor(dayName);
        const check = title && body ? this.checkWords(title, body, topics) : { clean: false, red: [{ matched: '生成缺失' }], orange: [] };
        const useAi = Boolean(title && body && check.clean);

        rows.push({
          index: rows.length + 1,
          accountNo: base.index,
          targetKeyword,
          day: dayName,
          persona: base.persona,
          suggestedTime: local?.suggestedTime || `${dayName} 20:00`,
          title: useAi ? title : local?.title || title || '待补充',
          body: useAi ? body : local?.body || body || '待补充',
          topics: (useAi ? topics : (local?.topics?.split(' ') || topics)).join(' '),
          coverPlan,
          imagePlan,
          riskCheck: useAi ? { clean: true, red: [], orange: [] } : local?.riskCheck || { clean: false, red: [], orange: [] },
          generatedBy: useAi ? 'dual-ai' : 'fallback',
        });
      }
    }

    const seenTitles = new Set<string>();
    for (let i = 0; i < rows.length; i += 1) {
      const key = this.compactText(rows[i].title);
      if (seenTitles.has(key)) {
        const fb = fallbackByKey.get(`${rows[i].accountNo}-${rows[i].day}`);
        if (fb && !seenTitles.has(this.compactText(fb.title))) {
          rows[i] = { ...fb, index: rows[i].index, generatedBy: 'fallback' };
          seenTitles.add(this.compactText(fb.title));
        }
      } else {
        seenTitles.add(key);
      }
    }

    const titleCounts = new Map<string, number>();
    for (const row of rows) {
      const key = this.compactText(row.title);
      titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
    }
    const duplicatePairs: any[] = [];
    for (const [title, count] of titleCounts) {
      if (count > 1) duplicatePairs.push({ level: 'red', title, reason: `标题出现 ${count} 次` });
    }

    return {
      version: '2026.09.08',
      generatedAt: new Date().toISOString(),
      mode: 'daily',
      generatedBy: 'dual-ai',
      requestedAccounts: safeCount,
      requestedDays: 7,
      returned: rows.length,
      rows,
      audit: {
        bannedWordCount: rows.filter((r) => !r.riskCheck?.clean).length,
        duplicatePairs,
        clean: duplicatePairs.length === 0 && rows.every((r) => r.riskCheck?.clean),
      },
    };
  }

  async check(user: any, input: CheckInput) {
    const title = input.title?.trim() ?? '';
    const body = input.body?.trim() ?? '';
    const tags = Array.isArray(input.tags)
      ? input.tags.map((t) => String(t).trim()).filter(Boolean)
      : [];

    if (!title && !body && tags.length === 0 && !input.drafts?.length && !input.historyTexts?.length) {
      throw new BadRequestException('请填写标题、正文、标签，或粘贴需要查重的文案');
    }

    const wordCheck = this.checkWords(title, body, tags);
    const duplicateCheck = await this.checkDuplicates(user, input, title, body);
    const semanticCheck = input.useSemantic
      ? await this.semanticCheck(user, input, title, body)
      : { enabled: false, reason: '未启用大模型语义查重' };
    const semanticPairs = (semanticCheck as any).pairs ?? [];

    const redCount =
      wordCheck.red.length +
      duplicateCheck.pairs.filter((p) => p.level === 'red').length +
      semanticPairs.filter((p: any) => p.level === 'red').length;
    const orangeCount =
      wordCheck.orange.length +
      duplicateCheck.pairs.filter((p) => p.level === 'orange').length +
      semanticPairs.filter((p: any) => p.level === 'orange').length;
    const clean = redCount === 0 && orangeCount === 0;

    return {
      lexiconVersion: LEXICON_VERSION,
      checkedAt: new Date().toISOString(),
      wordCheck,
      duplicateCheck,
      semanticCheck,
      summary: {
        clean,
        redCount,
        orangeCount,
        suggestions: [
          ...wordCheck.red.map((m) => m.suggestion),
          ...wordCheck.orange.map((m) => m.suggestion),
          ...duplicateCheck.pairs.map((p) => this.duplicateSuggestion(p)),
        ].filter((v, i, arr) => v && arr.indexOf(v) === i),
      },
    };
  }

  private normalizeText(text: string): string {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/\s+/g, '');
  }

  private compactText(text: string): string {
    return this.normalizeText(text).replace(/[^\p{Script=Han}a-z0-9]/gu, '');
  }

  private checkWords(title: string, body: string, tags: string[]) {
    const source: Record<string, string> = {
      title,
      body,
      tags: tags.join(' '),
    };

    const red: MatchItem[] = [];
    const orange: MatchItem[] = [];
    const seen = new Set<string>();

    for (const rule of LEXICON_RULES) {
      for (const term of rule.terms) {
        const normalizedTerm = this.normalizeText(term);
        if (!normalizedTerm) continue;
        for (const [field, value] of Object.entries(source)) {
          const normalizedValue = this.normalizeText(value);
          if (!normalizedValue.includes(normalizedTerm)) continue;
          const key = `${rule.id}:${term}:${field}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const item: MatchItem = {
            ruleId: rule.id,
            category: rule.category,
            level: rule.level,
            matched: term,
            suggestion: rule.suggestion,
          };
          (rule.level === 'red' ? red : orange).push(item);
        }
      }
    }

    for (const rule of LEXICON_REGEX_RULES) {
      for (const [field, value] of Object.entries(source)) {
        const matches = value.match(rule.pattern);
        if (!matches?.length) continue;
        for (const matched of matches) {
          const key = `${rule.id}:${matched}:${field}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const item: MatchItem = {
            ruleId: rule.id,
            category: rule.category,
            level: rule.level,
            matched,
            suggestion: rule.suggestion,
          };
          (rule.level === 'red' ? red : orange).push(item);
        }
      }
    }

    return { red, orange, clean: red.length === 0 && orange.length === 0 };
  }

  private shingles(text: string, n = 2): Set<string> {
    const chars = Array.from(this.compactText(text));
    const set = new Set<string>();
    if (!chars.length) return set;
    for (let i = 0; i + n <= chars.length; i += 1) {
      set.add(chars.slice(i, i + n).join(''));
    }
    return set;
  }

  private similarity(a: string, b: string): number {
    const setA = this.shingles(a);
    const setB = this.shingles(b);
    if (!setA.size || !setB.size) return 0;
    let intersection = 0;
    for (const item of setA) {
      if (setB.has(item)) intersection += 1;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  private classifySimilarity(titleSimilarity: number, bodySimilarity: number): RiskLevel | 'none' {
    if (bodySimilarity >= 0.72 || titleSimilarity >= 0.9) return 'red';
    if (bodySimilarity >= 0.48 || titleSimilarity >= 0.62) return 'orange';
    return 'none';
  }

  private duplicateSuggestion(pair: SimilarityItem): string {
    if (pair.level === 'none') return '';
    if (pair.level === 'red') {
      return `「${pair.sourceLabel}」和「${pair.targetLabel}」重复度过高，请改写其中一篇或调整角度。`;
    }
    return `「${pair.sourceLabel}」和「${pair.targetLabel}」存在部分重复，建议换一个开头或案例。`;
  }

  private async checkDuplicates(user: any, input: CheckInput, title: string, body: string) {
    const pairs: SimilarityItem[] = [];

    const currentDraft: DraftInput = {
      id: 'current',
      title,
      body,
    };

    const drafts: DraftInput[] = [
      ...(currentDraft.title || currentDraft.body ? [currentDraft] : []),
      ...(input.drafts ?? []).map((d, i) => ({
        id: d.id || `draft-${i + 1}`,
        title: d.title?.trim() ?? '',
        body: d.body?.trim() ?? '',
      })),
      ...(input.historyTexts ?? []).map((text, i) => ({
        id: `history-${i + 1}`,
        title: '',
        body: text.trim(),
      })),
    ].filter((d) => d.title || d.body);

    for (let i = 0; i < drafts.length; i += 1) {
      for (let j = i + 1; j < drafts.length; j += 1) {
        const a = drafts[i];
        const b = drafts[j];
        const titleSimilarity = a.title && b.title ? this.similarity(a.title, b.title) : 0;
        const bodySimilarity = a.body && b.body ? this.similarity(a.body, b.body) : 0;
        const level = this.classifySimilarity(titleSimilarity, bodySimilarity);
        if (level === 'none') continue;
        pairs.push({
          sourceId: a.id || '',
          sourceLabel: this.draftLabel(a, i + 1),
          targetId: b.id || '',
          targetLabel: this.draftLabel(b, j + 1),
          titleSimilarity: Number(titleSimilarity.toFixed(2)),
          bodySimilarity: Number(bodySimilarity.toFixed(2)),
          level,
        });
      }
    }

    const storedMatches: SimilarityItem[] = [];
    if (input.includeStoredNotes !== false && user?.studioId) {
      const notes = await this.prisma.trafficNote.findMany({
        where: { studioId: user.studioId, title: { not: null } },
        select: { id: true, title: true, note: true, publishDate: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      for (const note of notes) {
        const titleSimilarity = title && note.title ? this.similarity(title, note.title) : 0;
        const bodySimilarity = body && note.note ? this.similarity(body, note.note) : 0;
        const level = this.classifySimilarity(titleSimilarity, bodySimilarity);
        if (level === 'none') continue;
        storedMatches.push({
          sourceId: 'current',
          sourceLabel: '当前文案',
          targetId: note.id,
          targetLabel: note.title || note.id.slice(0, 8),
          titleSimilarity: Number(titleSimilarity.toFixed(2)),
          bodySimilarity: Number(bodySimilarity.toFixed(2)),
          level,
        });
      }
    }

    return {
      pairs,
      storedMatches,
      clean: pairs.length === 0 && storedMatches.length === 0,
    };
  }

  private draftLabel(draft: DraftInput, index: number): string {
    if (draft.id === 'current') return '当前文案';
    if (draft.title) return draft.title.length > 12 ? `${draft.title.slice(0, 12)}…` : draft.title;
    return draft.id?.startsWith('history-') ? `历史文案 ${index}` : `草稿 ${index}`;
  }

  private async getAiConfig() {
    const getValue = async (key: string, envKey?: string) => {
      const cfg = await this.prisma.systemConfig.findUnique({ where: { key } }).catch(() => null);
      const value = cfg?.value as any;
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (envKey && process.env[envKey]) return process.env[envKey] as string;
      return '';
    };
    const provider = (await getValue('ai.provider')) || 'doubao';
    const deepseekKey = await getValue('ai.deepseek_api_key', 'DEEPSEEK_API_KEY');
    const doubaoKey = await getValue('ai.doubao_api_key', 'DOUBAO_API_KEY');
    const doubaoModel = (await getValue('ai.doubao_model')) || 'doubao-pro-32k';
    return { provider, deepseekKey, doubaoKey, doubaoModel };
  }

  private parseJsonFromText(text: string): any {
    if (!text) return null;
    let t = text.trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    try {
      return JSON.parse(t);
    } catch {}
    const start = t.indexOf('[');
    const end = t.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch {}
    }
    const objStart = t.indexOf('{');
    const objEnd = t.lastIndexOf('}');
    if (objStart >= 0 && objEnd > objStart) {
      try {
        return JSON.parse(t.slice(objStart, objEnd + 1));
      } catch {}
    }
    return null;
  }

  private async semanticCheck(user: any, input: CheckInput, title: string, body: string) {
    const { provider, deepseekKey, doubaoKey, doubaoModel } = await this.getAiConfig();
    const apiKey = provider === 'deepseek' ? deepseekKey : doubaoKey;
    if (!apiKey) {
      return { enabled: false, reason: '未配置 AI API Key，无法进行语义查重', provider };
    }

    const candidates: Array<{ index: number; label: string; title: string; body: string }> = [];
    (input.drafts ?? []).forEach((d, i) => {
      candidates.push({
        index: i,
        label: `草稿 ${i + 1}`,
        title: d.title?.trim() ?? '',
        body: d.body?.trim() ?? '',
      });
    });
    (input.historyTexts ?? []).forEach((text, i) => {
      candidates.push({
        index: candidates.length,
        label: `历史文案 ${i + 1}`,
        title: '',
        body: text.trim(),
      });
    });

    if (input.includeStoredNotes !== false && user?.studioId) {
      const notes = await this.prisma.trafficNote.findMany({
        where: { studioId: user.studioId, title: { not: null } },
        select: { id: true, title: true, note: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      notes.forEach((note) => {
        candidates.push({
          index: candidates.length,
          label: note.title || note.id.slice(0, 8),
          title: note.title || '',
          body: note.note || '',
        });
      });
    }

    const relevant = candidates
      .filter((c) => c.title || c.body)
      .slice(0, 50);

    if (!relevant.length) {
      return { enabled: true, provider, reason: '没有可比较的候选文案', pairs: [], clean: true };
    }

    const candidateText = relevant
      .map((c) => `${c.index}. 【${c.label}】标题：${c.title || '无'}；正文：${c.body || '无'}`)
      .join('\n');

    const prompt = `你是中文内容查重助手。请判断下面「当前文案」与每个「候选文案」是否存在语义层面的重复。

判断标准：
- red：核心卖点、内容结构、表达意图高度一致，换词但实质相同；
- orange：部分观点、卖点或表达相似，但角度或结构不同；
- none：明显不同，不构成重复。

只返回一个 JSON 数组，不要 Markdown，不要解释，格式如下：
[{"index":0,"level":"red|orange|none","reason":"不超过20字"}]

当前文案：
标题：${title || '无'}
正文：${body || '无'}

候选文案：
${candidateText}`;

    let endpoint = '';
    let model = '';
    if (provider === 'deepseek') {
      endpoint = 'https://api.deepseek.com/chat/completions';
      model = 'deepseek-chat';
    } else {
      endpoint = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
      model = doubaoModel;
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: '你是严谨的内容查重助手，只输出 JSON 数组。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0,
          max_tokens: 2000,
        }),
      });
      if (!res.ok) {
        return { enabled: true, provider, error: `模型调用失败（HTTP ${res.status}）`, pairs: [], clean: true };
      }
      const json: any = await res.json();
      const content = json?.choices?.[0]?.message?.content || '';
      const parsed = this.parseJsonFromText(content);
      const rawPairs = Array.isArray(parsed) ? parsed : [];
      const pairs = rawPairs
        .map((p: any) => {
          const candidate = relevant.find((c) => c.index === Number(p?.index));
          const level = ['red', 'orange', 'none'].includes(p?.level) ? p.level : 'none';
          if (!candidate || level === 'none') return null;
          return {
            sourceId: 'current',
            sourceLabel: '当前文案',
            targetId: String(candidate.index),
            targetLabel: candidate.label,
            level,
            reason: typeof p?.reason === 'string' ? p.reason.slice(0, 100) : '',
          };
        })
        .filter(Boolean);
      return {
        enabled: true,
        provider,
        candidatesCount: relevant.length,
        pairs,
        clean: pairs.length === 0,
      };
    } catch (error: any) {
      return {
        enabled: true,
        provider,
        error: error?.message || '模型调用失败',
        pairs: [],
        clean: true,
      };
    }
  }
}
