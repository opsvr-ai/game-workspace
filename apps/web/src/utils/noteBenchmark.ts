// 图文笔记及格线判级（与后端保持一致，阈值来自豆包建议，可在「设置 → AI 分析」里动态调整）

export interface BenchmarkThresholds {
  clickRate: { eliminate: number; pass: number; good: number };
  interactionRate: { eliminate: number; pass: number; good: number };
  dmRate: { eliminate: number; pass: number; good: number };
  searchRatio: { min: number; idealLow: number; idealHigh: number };
  profileRatio: { ok: number; warn: number };
  readCompletionRate: { min: number };
}

export const DEFAULT_BENCHMARKS: BenchmarkThresholds = {
  clickRate: { eliminate: 2.5, pass: 4.5, good: 4.5 },
  interactionRate: { eliminate: 2, pass: 3.5, good: 3.5 },
  dmRate: { eliminate: 0.5, pass: 1.5, good: 3 },
  searchRatio: { min: 10, idealLow: 20, idealHigh: 40 },
  profileRatio: { ok: 10, warn: 20 },
  readCompletionRate: { min:40 },
};

export interface MetricEvaluation {
  key: string;
  label: string;
  value: number | null;
  level: 'red' | 'orange' | 'green' | 'blue';
  tier: string;
  hint: string;
}

export function mergeBenchmarks(raw: any): BenchmarkThresholds {
  const b = raw && typeof raw === 'object' ? raw : {};
  return {
    clickRate: { ...DEFAULT_BENCHMARKS.clickRate, ...(b.clickRate || {}) },
    interactionRate: { ...DEFAULT_BENCHMARKS.interactionRate, ...(b.interactionRate || {}) },
    dmRate: { ...DEFAULT_BENCHMARKS.dmRate, ...(b.dmRate || {}) },
    searchRatio: { ...DEFAULT_BENCHMARKS.searchRatio, ...(b.searchRatio || {}) },
    profileRatio: { ...DEFAULT_BENCHMARKS.profileRatio, ...(b.profileRatio || {}) },
    readCompletionRate: { ...DEFAULT_BENCHMARKS.readCompletionRate, ...(b.readCompletionRate || {}) },
  };
}

export function evaluateNote(note: any, raw: any): MetricEvaluation[] {
  const b = mergeBenchmarks(raw);
  const n = (v: any): number | null => (v == null || v === '' ? null : Number(v));
  const mk = (key: string, label: string, value: number | null, level: MetricEvaluation['level'], tier: string, hint: string): MetricEvaluation =>
    ({ key, label, value, level, tier, hint });
  const out: MetricEvaluation[] = [];

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
