import http from './client';

export interface ContentCheckMatch {
  ruleId: string;
  category: string;
  level: 'red' | 'orange';
  matched: string;
  suggestion: string;
}

export interface ContentCheckPair {
  sourceId: string;
  sourceLabel: string;
  targetId: string;
  targetLabel: string;
  titleSimilarity: number;
  bodySimilarity: number;
  level: 'red' | 'orange' | 'none';
}

export interface ContentCheckSemanticPair {
  sourceId: string;
  sourceLabel: string;
  targetId: string;
  targetLabel: string;
  level: 'red' | 'orange' | 'none';
  reason: string;
}

export interface ContentCheckResult {
  lexiconVersion: string;
  checkedAt: string;
  wordCheck: {
    red: ContentCheckMatch[];
    orange: ContentCheckMatch[];
    clean: boolean;
  };
  duplicateCheck: {
    pairs: ContentCheckPair[];
    storedMatches: ContentCheckPair[];
    clean: boolean;
  };
  semanticCheck: {
    enabled: boolean;
    provider?: string;
    reason?: string;
    error?: string;
    candidatesCount?: number;
    pairs?: ContentCheckSemanticPair[];
    clean?: boolean;
  };
  summary: {
    clean: boolean;
    redCount: number;
    orangeCount: number;
    suggestions: string[];
  };
}

export interface WeeklyPlanRow {
  accountNo?: number;
  day?: string;
  index: number;
  persona: string;
  suggestedTime: string;
  targetKeyword?: string;
  title: string;
  body: string;
  topics: string;
  coverPlan?: string;
  imagePlan?: string;
  generatedBy?: string;
  riskCheck: {
    clean: boolean;
    red: any[];
    orange: any[];
  };
}

export interface WeeklyPlanResult {
  version: string;
  generatedAt: string;
  mode?: string;
  generatedBy?: string;
  requested: number;
  requestedAccounts?: number;
  requestedDays?: number;
  returned: number;
  rows: WeeklyPlanRow[];
  audit: {
    bannedWordCount: number;
    duplicatePairs: any[];
    clean: boolean;
  };
}

export const contentCheckApi = {
  lexicon: () => http.get('/content-check/lexicon'),
  weeklyPlan: (count = 30, mode: 'weekly' | 'daily' = 'weekly') =>
    http.get('/content-check/weekly-plan', { params: { count, mode } }),
  generatePlan: (data: { count?: number; mode?: 'weekly' | 'daily'; useAi?: boolean; keywords?: string[] }) =>
    http.post('/content-check/generate-plan', data, { timeout: 600000 }),
  rewriteRow: (data: {
    title?: string;
    body?: string;
    topics?: string;
    coverPlan?: string;
    imagePlan?: string;
    persona?: string;
    mode?: string;
    keyword?: string;
    day?: string;
    instruction?: string;
  }) => http.post('/content-check/rewrite-row', data, { timeout: 180000 }),
  benchmarkGenerate: (data: { count?: number; notes?: any[]; keywords?: string[]; benchmarkSummary?: string }) =>
    http.post('/content-check/benchmark-generate', data, { timeout: 600000 }),
  benchmarkAnalyze: (data: { notes?: any[] }) =>
    http.post('/content-check/benchmark-analyze', data, { timeout: 180000 }),
  check: (data: {
    title?: string;
    body?: string;
    tags?: string[];
    historyTexts?: string[];
    includeStoredNotes?: boolean;
    useSemantic?: boolean;
  }) => http.post('/content-check/check', data, { timeout: 180000 }),
};
