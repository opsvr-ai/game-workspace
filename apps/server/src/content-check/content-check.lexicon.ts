export const LEXICON_VERSION = '2026.09.08';

export type RiskLevel = 'red' | 'orange';

export interface LexiconRule {
  id: string;
  category: string;
  level: RiskLevel;
  terms: string[];
  suggestion: string;
}

export interface LexiconRegexRule {
  id: string;
  category: string;
  level: RiskLevel;
  pattern: RegExp;
  suggestion: string;
}

export const LEXICON_RULES: LexiconRule[] = [
  {
    id: 'contact-wechat',
    category: '站外导流',
    level: 'red',
    terms: ['微信', '威信', '微信号', 'vx', 'v信', '加v', '加vx', '加微信', '加威信', '+v', '+vx'],
    suggestion: '去掉微信或变体写法，只引导用户查看主页或使用站内沟通。',
  },
  {
    id: 'contact-qq',
    category: '站外导流',
    level: 'red',
    terms: ['qq', '加qq', '扣扣', 'q号'],
    suggestion: '不要在笔记或评论区留 QQ，改为站内承接。',
  },
  {
    id: 'contact-qr',
    category: '站外导流',
    level: 'red',
    terms: ['二维码', '扫码', '扫一扫'],
    suggestion: '二维码和扫码字样属于高风控词，删掉。',
  },
  {
    id: 'contact-private-message',
    category: '诱导私信',
    level: 'red',
    terms: ['私信我', '私我', '主页加我', '加我', '秒通过', '私我秒', '私聊我'],
    suggestion: '把“私我”改成“主页问一句”，不要诱导用户留联系方式。',
  },
  {
    id: 'contact-other-platform',
    category: '站外导流',
    level: 'orange',
    terms: ['公众号', '淘宝', '拼多多', '闲鱼', '咸鱼', '抖音', '快手', '哔哩哔哩'],
    suggestion: '除非内容是纯分享，否则提到其他平台容易被判导流，建议删掉。',
  },
  {
    id: 'promo-low-price',
    category: '低价营销',
    level: 'orange',
    terms: ['低价', '特价', '白菜价', '便宜', '全网最低', '最低价'],
    suggestion: '避免价格诱导词，改成“散陪/个人陪”和具体服务说明。',
  },
  {
    id: 'promo-absolute',
    category: '极限词',
    level: 'orange',
    terms: ['第一', '顶级', '唯一', '全网第一', '最强', '最好', '绝版', '国家级', '世界级'],
    suggestion: '去掉极限词，用真实数据代替夸张承诺。',
  },
  {
    id: 'promo-guarantee',
    category: '虚假承诺',
    level: 'red',
    terms: ['稳赚', '保证', '零风险', '包过', '无效退款', '必过', '稳赢'],
    suggestion: '删除保证类承诺，改为客观描述技术和服务。',
  },
  {
    id: 'interaction-brush',
    category: '异常互动',
    level: 'orange',
    terms: ['互粉', '互赞', '互评', '刷单', '好评返现', '转发抽奖', '点赞送', '褥羊毛', '羊毛'],
    suggestion: '避免互推、返现和抽奖类诱导词。',
  },
  {
    id: 'context-ambiguous',
    category: '语境风险',
    level: 'orange',
    terms: ['暧昧', '私约', '线下约', '陪睡', '特殊服务'],
    suggestion: '这些词会把账号带进低俗内容风险池，建议全部删除。',
  },
  {
    id: 'template-cliché',
    category: '烂大街模板',
    level: 'orange',
    terms: ['谁懂啊', '破防了', '全款拿下', '姐妹们冲', '救命'],
    suggestion: '换成真实、具体、有个人风格的口语，降低模板痕迹。',
  },
];

export const LEXICON_REGEX_RULES: LexiconRegexRule[] = [
  {
    id: 'contact-phone',
    category: '站外导流',
    level: 'red',
    pattern: /(?:\+?86[- ]?)?1[3-9]\d{9}/g,
    suggestion: '正文里不要出现手机号或疑似手机号。',
  },
  {
    id: 'contact-url',
    category: '站外导流',
    level: 'red',
    pattern: /https?:\/\/\S+/gi,
    suggestion: '不要放外链，平台外链接会直接触发审核。',
  },
];

export interface LexiconExport {
  version: string;
  updatedAt: string;
  rules: LexiconRule[];
  regexRules: Array<Omit<LexiconRegexRule, 'pattern'> & { pattern: string }>;
}

export function exportLexicon(): LexiconExport {
  return {
    version: LEXICON_VERSION,
    updatedAt: '2026-09-08',
    rules: LEXICON_RULES,
    regexRules: LEXICON_REGEX_RULES.map((r) => ({ ...r, pattern: r.pattern.source })),
  };
}
