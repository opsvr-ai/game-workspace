import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Divider, Empty, Input, List, Modal, Progress, Row, Select, Space, Table, Tag, Typography, message,
} from 'antd';
import { CheckCircleOutlined, CopyOutlined, SafetyOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { contentCheckApi, ContentCheckResult, WeeklyPlanResult } from '../api/contentCheck';

const { Title, Text } = Typography;

const ContentCheckPage: React.FC = () => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [historyText, setHistoryText] = useState('');
  const [includeStoredNotes, setIncludeStoredNotes] = useState(true);
  const [useSemantic, setUseSemantic] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ContentCheckResult | null>(null);
  const [lexiconVersion, setLexiconVersion] = useState('');
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlanResult | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [rewriteRowData, setRewriteRowData] = useState<any>(null);
  const [rewriteNote, setRewriteNote] = useState('');
  const [rewriting, setRewriting] = useState(false);
  const [benchmarkJson, setBenchmarkJson] = useState('');
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [benchmarkSummary, setBenchmarkSummary] = useState('');
  const [benchmarkAnalysis, setBenchmarkAnalysis] = useState<any>(null);
  const [benchmarkNotes, setBenchmarkNotes] = useState<any[]>([]);
  const [benchmarkKeywords, setBenchmarkKeywords] = useState<string[]>([]);
  const [keywordText, setKeywordText] = useState('');

  useEffect(() => {
    contentCheckApi
      .lexicon()
      .then(({ data }: any) => {
        setLexiconVersion(data?.data?.version || '');
      })
      .catch(() => {});
  }, []);

  const doCheck = useCallback(async () => {
    if (!title.trim() && !body.trim() && tags.length === 0 && !historyText.trim()) {
      message.warning('请填写标题、正文、标签，或粘贴需要查重的历史文案');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const historyTexts = historyText
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
      const { data } = await contentCheckApi.check({
        title,
        body,
        tags,
        historyTexts,
        includeStoredNotes,
        useSemantic,
      });
      setResult(data.data ?? null);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '检测失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  }, [body, historyText, includeStoredNotes, tags, title, useSemantic]);

  const generatePlan = async (mode: 'weekly' | 'daily' = 'weekly', useAi = false) => {
    setPlanLoading(true);
    try {
      const manualKeywords = keywordText
        .split(/\n+/)
        .map((k) => k.trim())
        .filter(Boolean);
      const keywords = manualKeywords.length ? manualKeywords : benchmarkKeywords;
      if (!keywords.length) {
        message.warning('请先在“手动长尾词库”填词，或先点“先拆解建议”提取长尾词');
        setPlanLoading(false);
        return;
      }
      const { data } = await contentCheckApi.generatePlan({ count: 30, mode, useAi, keywords });
      setWeeklyPlan(data.data ?? null);
      setTimeout(() => document.getElementById('plan-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    } catch {
      message.error('生成周内容模板失败');
    } finally {
      setPlanLoading(false);
    }
  };

  const copyPlan = async () => {
    if (!weeklyPlan?.rows?.length) return;
    const isDaily = weeklyPlan.mode === 'daily';
    const headers = isDaily
      ? ['账号', '星期', '核心长尾词', '人设/方向', '建议时间', '标题', '文案', '话题', '封面构图', '配图建议']
      : ['编号', '核心长尾词', '人设/方向', '建议时间', '标题', '文案', '话题', '封面构图', '配图建议'];
    const lines = [
      headers.join('\t'),
      ...weeklyPlan.rows.map((r) =>
        (isDaily
          ? [r.accountNo ?? r.index, r.day ?? '', r.targetKeyword || '', r.persona, r.suggestedTime, r.title, r.body, r.topics, r.coverPlan || '', r.imagePlan || '']
          : [r.index, r.targetKeyword || '', r.persona, r.suggestedTime, r.title, r.body, r.topics, r.coverPlan || '', r.imagePlan || '']
        ).join('\t'),
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      message.success('已复制整张周内容模板');
    } catch {
      message.error('复制失败，请手动选择表格复制');
    }
  };

  const openRewrite = (row: any) => {
    setRewriteRowData(row);
    setRewriteNote('');
  };

  const submitRewrite = async () => {
    if (!rewriteRowData) return;
    setRewriting(true);
    try {
      const { data } = await contentCheckApi.rewriteRow({
        title: rewriteRowData.title,
        body: rewriteRowData.body,
        topics: rewriteRowData.topics,
        coverPlan: rewriteRowData.coverPlan,
        imagePlan: rewriteRowData.imagePlan,
        persona: rewriteRowData.persona,
        day: rewriteRowData.day,
        instruction: rewriteNote,
      });
      const next = data.data ?? null;
      if (!next) throw new Error('空结果');
      setWeeklyPlan((prev) => {
        if (!prev) return prev;
        const rows = [...(prev.rows || [])];
        const index = rows.findIndex((r) => r.index === rewriteRowData.index || (r.accountNo === rewriteRowData.accountNo && r.day === rewriteRowData.day));
        if (index >= 0) {
          rows[index] = {
            ...rows[index],
            title: next.title,
            body: next.body,
            topics: next.topics,
            coverPlan: next.coverPlan,
            imagePlan: next.imagePlan,
            riskCheck: next.riskCheck,
            generatedBy: next.generatedBy,
          };
        }
        return { ...prev, rows };
      });
      message.success('这一条已重写');
      setRewriteRowData(null);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '重写失败');
    } finally {
      setRewriting(false);
    }
  };

  const analyzeBenchmark = async () => {
    if (!benchmarkJson.trim()) {
      message.warning('请先粘贴从扩展复制出来的 JSON');
      return;
    }

    let notes: any[];
    try {
      notes = JSON.parse(benchmarkJson);
    } catch {
      message.error('JSON 格式不对，请从扩展里点“复制 JSON”后原样粘贴');
      return;
    }

    if (!Array.isArray(notes) || notes.length < 3) {
      message.warning('至少需要 3 条笔记');
      return;
    }

    setBenchmarkLoading(true);
    try {
      const { data } = await contentCheckApi.benchmarkAnalyze({ notes });
      setBenchmarkNotes(notes);
      setBenchmarkSummary(data.data?.benchmarkSummary || '');
      setBenchmarkAnalysis(data.data?.benchmarkAnalysis || null);
      setBenchmarkKeywords(data.data?.recommendedKeywords || []);
      message.success('已拆解出爆款规律，请查看后确认生成');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '拆解失败');
    } finally {
      setBenchmarkLoading(false);
    }
  };

  const generateFromBenchmark = async () => {
    if (!benchmarkSummary) {
      message.warning('请先点“先拆解建议”');
      return;
    }

    setBenchmarkLoading(true);
    try {
      const manualKeywords = keywordText
        .split(/\n+/)
        .map((k) => k.trim())
        .filter(Boolean);
      const keywords = manualKeywords.length ? manualKeywords : benchmarkKeywords;
      if (!keywords.length) {
        message.warning('没有可用长尾词，请先拆解建议或在“手动长尾词库”填词');
        return;
      }
      const { data } = await contentCheckApi.benchmarkGenerate({
        count: 30,
        notes: benchmarkNotes,
        keywords,
        benchmarkSummary,
      });
      setWeeklyPlan(data.data?.plan ?? null);
      setBenchmarkSummary(data.data?.benchmarkSummary || benchmarkSummary);
      message.success('已根据拆解建议生成 30 人 × 7 天内容');
      setTimeout(() => document.getElementById('plan-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '生成失败');
    } finally {
      setBenchmarkLoading(false);
    }
  };

  const renderMatches = (items: any[], color: 'red' | 'orange') => {
    if (!items?.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有命中" />;
    return (
      <List
        size="small"
        dataSource={items}
        renderItem={(item: any) => (
          <List.Item>
            <div style={{ width: '100%' }}>
              <Space size={6} wrap>
                <Tag color={color}>{item.category}</Tag>
                <Text code>{item.matched}</Text>
              </Space>
              <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>{item.suggestion}</div>
            </div>
          </List.Item>
        )}
      />
    );
  };

  const renderPairs = (items: any[]) => {
    if (!items?.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有明显重复" />;
    return (
      <List
        size="small"
        dataSource={items}
        renderItem={(item: any) => (
          <List.Item>
            <div style={{ width: '100%' }}>
              <Space size={6} wrap>
                <Tag color={item.level === 'red' ? 'red' : 'orange'}>{item.level === 'red' ? '高重复' : '部分重复'}</Tag>
                <Text>{item.sourceLabel}</Text>
                <Text type="secondary">↔</Text>
                <Text>{item.targetLabel}</Text>
              </Space>
              <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>
                标题相似 {Math.round((item.titleSimilarity || 0) * 100)}% · 正文相似 {Math.round((item.bodySimilarity || 0) * 100)}%
              </div>
            </div>
          </List.Item>
        )}
      />
    );
  };

  const renderSemanticPairs = (items: any[]) => {
    if (!items?.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未发现语义重复" />;
    return (
      <List
        size="small"
        dataSource={items}
        renderItem={(item: any) => (
          <List.Item>
            <div style={{ width: '100%' }}>
              <Space size={6} wrap>
                <Tag color={item.level === 'red' ? 'red' : 'orange'}>{item.level === 'red' ? '语义高重复' : '语义部分重复'}</Tag>
                <Text>{item.sourceLabel}</Text>
                <Text type="secondary">↔</Text>
                <Text>{item.targetLabel}</Text>
              </Space>
              <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>{item.reason || '语义表达相似'}</div>
            </div>
          </List.Item>
        )}
      />
    );
  };

  const isDailyPlan = weeklyPlan?.mode === 'daily';
  const planColumns = isDailyPlan
    ? [
        { title: '账号', dataIndex: 'accountNo', width: 58, fixed: 'left' as const },
        { title: '星期', dataIndex: 'day', width: 58 },
        { title: '核心长尾词', dataIndex: 'targetKeyword', width: 130 },
        { title: '人设 / 方向', dataIndex: 'persona', width: 130 },
        { title: '建议时间', dataIndex: 'suggestedTime', width: 100 },
        { title: '标题', dataIndex: 'title', width: 190 },
        { title: '文案', dataIndex: 'body', width: 330 },
        { title: '话题', dataIndex: 'topics', width: 170 },
        { title: '封面构图', dataIndex: 'coverPlan', width: 220 },
        { title: '配图建议', dataIndex: 'imagePlan', width: 190 },
      ]
    : [
        { title: '编号', dataIndex: 'index', width: 52, fixed: 'left' as const },
        { title: '核心长尾词', dataIndex: 'targetKeyword', width: 130 },
        { title: '人设 / 方向', dataIndex: 'persona', width: 130 },
        { title: '建议时间', dataIndex: 'suggestedTime', width: 100 },
        { title: '标题', dataIndex: 'title', width: 180 },
        { title: '文案', dataIndex: 'body', width: 330 },
        { title: '话题', dataIndex: 'topics', width: 170 },
        { title: '封面构图', dataIndex: 'coverPlan', width: 220 },
        { title: '配图建议', dataIndex: 'imagePlan', width: 190 },
      ];
  const planTableColumns = [
    ...planColumns,
    {
      title: '操作',
      key: 'actions',
      width: 64,
      fixed: 'right' as const,
      render: (_: unknown, row: any) => (
        <Button size="small" onClick={() => openRewrite(row)}>
          重写
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>内容查重 + 违禁词检测</Title>
          <Text type="secondary">
            用于小红书、抖音等笔记发布前检查
            {lexiconVersion ? ` · 词库版本 ${lexiconVersion}` : ''}
          </Text>
        </div>
        <Button type="primary" icon={<ThunderboltOutlined />} loading={loading} onClick={doCheck}>
          开始检测
        </Button>
      </div>

      <Row gutter={16}>
        <Col span={12}>
          <Card title="待检测内容" size="small">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="标题（20 字以内，只放一个核心关键词）"
                maxLength={60}
              />
              <Input.TextArea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="正文"
                autoSize={{ minRows: 8, maxRows: 16 }}
              />
              <Select
                mode="tags"
                value={tags}
                onChange={setTags}
                placeholder="标签，输入后回车添加"
                open={false}
                suffixIcon={null}
              />
              <Divider style={{ margin: '4px 0' }}>历史 / 同批文案</Divider>
              <Input.TextArea
                value={historyText}
                onChange={(e) => setHistoryText(e.target.value)}
                placeholder={'每行粘贴一条历史文案，用于查重\n例如：\n散陪双人车，掉落都归你……\n个人陪也接，主要话多……'}
                autoSize={{ minRows: 8, maxRows: 16 }}
              />
              <Button size="small" onClick={() => setIncludeStoredNotes((v) => !v)}>
                {includeStoredNotes ? '✅ 同时与系统已录笔记对比' : '☑️ 不与系统已录笔记对比'}
              </Button>
              <Button size="small" type={useSemantic ? 'primary' : 'default'} onClick={() => setUseSemantic((v) => !v)}>
                {useSemantic ? '🧠 已启用大模型语义查重' : '🧠 启用大模型语义查重'}
              </Button>
            </div>
          </Card>
        </Col>

        <Col span={12}>
          <Card title="检测结果" size="small">
            {!result ? (
              <Empty description="填写内容后点击“开始检测”" />
            ) : (
              <div>
                <Alert
                  type={result.summary.clean ? 'success' : result.summary.redCount > 0 ? 'error' : 'warning'}
                  showIcon
                  icon={result.summary.clean ? <CheckCircleOutlined /> : <SafetyOutlined />}
                  message={
                    result.summary.clean
                      ? '未发现高危问题，可以发布'
                      : `发现 ${result.summary.redCount} 个高危项、${result.summary.orangeCount} 个提醒项`
                  }
                  description={
                    result.summary.clean
                      ? '仍建议结合平台实时规则和账号状态做最后判断'
                      : '建议先处理高危项，再处理提醒项'
                  }
                />

                <Divider orientation="left" style={{ margin: '12px 0 8px' }}>违禁词 / 风险词</Divider>
                <Row gutter={12}>
                  <Col span={12}>
                    <Text strong style={{ color: '#cf1322' }}>高危</Text>
                    {renderMatches(result.wordCheck.red, 'red')}
                  </Col>
                  <Col span={12}>
                    <Text strong style={{ color: '#d46b08' }}>提醒</Text>
                    {renderMatches(result.wordCheck.orange, 'orange')}
                  </Col>
                </Row>

                <Divider orientation="left" style={{ margin: '12px 0 8px' }}>查重结果</Divider>
                <Text strong>当前文案 / 同批草稿</Text>
                {renderPairs(result.duplicateCheck.pairs)}
                {result.duplicateCheck.storedMatches?.length > 0 && (
                  <>
                    <Divider style={{ margin: '8px 0' }} />
                    <Text strong>与系统已录笔记</Text>
                    {renderPairs(result.duplicateCheck.storedMatches)}
                  </>
                )}

                {result.semanticCheck?.enabled && (
                  <>
                    <Divider orientation="left" style={{ margin: '12px 0 8px' }}>大模型语义查重</Divider>
                    {result.semanticCheck.error ? (
                      <Alert type="warning" showIcon message={result.semanticCheck.error} />
                    ) : (
                      <>
                        <Text type="secondary">
                          使用 {result.semanticCheck.provider || 'AI'} 对 {result.semanticCheck.candidatesCount || 0} 条候选文案做语义比较
                        </Text>
                        {renderSemanticPairs(result.semanticCheck.pairs || [])}
                      </>
                    )}
                  </>
                )}

                {result.summary.suggestions?.length > 0 && (
                  <>
                    <Divider orientation="left" style={{ margin: '12px 0 8px' }}>修改建议</Divider>
                    <List
                      size="small"
                      dataSource={result.summary.suggestions}
                      renderItem={(item: string) => <List.Item style={{ padding: '4px 0' }}>• {item}</List.Item>}
                    />
                  </>
                )}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <Card
        title="手动长尾词库"
        size="small"
        style={{ marginTop: 16 }}
        extra={<Text type="secondary">每行一个词，生成时会按账号顺序分配</Text>}
      >
        <Input.TextArea
          value={keywordText}
          onChange={(e) => setKeywordText(e.target.value)}
          placeholder={'例如：\n三角洲机密撤离路线\n三角洲绝密撤离率\n三角洲有卡开卡\n三角洲怎么约'}
          autoSize={{ minRows: 6, maxRows: 14 }}
        />
      </Card>

      <Card
        title="对标笔记导入"
        size="small"
        style={{ marginTop: 16 }}
        extra={
          <Space>
            <Button icon={<ThunderboltOutlined />} loading={benchmarkLoading} onClick={analyzeBenchmark}>
              先拆解建议
            </Button>
            <Button type="primary" icon={<ThunderboltOutlined />} disabled={!benchmarkSummary} loading={benchmarkLoading} onClick={generateFromBenchmark}>
              确认生成
            </Button>
          </Space>
        }
      >
        <Input.TextArea
          value={benchmarkJson}
          onChange={(e) => setBenchmarkJson(e.target.value)}
          placeholder="把浏览器扩展里复制的 JSON 原样粘贴到这里"
          autoSize={{ minRows: 6, maxRows: 14 }}
        />
        {benchmarkLoading && (
          <div style={{ marginTop: 12 }}>
            <Progress percent={50} status="active" showInfo={false} />
            <Text type="secondary">正在处理，请勿关闭页面，通常需要 1—5 分钟。</Text>
          </div>
        )}
        {benchmarkSummary && (
          <div style={{ marginTop: 12, padding: 12, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8 }}>
            <Text strong style={{ color: '#389e0d' }}>已拆解出的爆款规律</Text>
            {benchmarkAnalysis ? (
              <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.8 }}>
                {[
                  ['标题公式', benchmarkAnalysis.titleFormulas],
                  ['开头钩子', benchmarkAnalysis.openingHooks],
                  ['正文结构', benchmarkAnalysis.bodyStructure],
                  ['封面特点', benchmarkAnalysis.coverFeatures],
                  ['话题选择', benchmarkAnalysis.topics],
                  ['建议长尾词', benchmarkAnalysis.keywords],
                  ['下一步建议', benchmarkAnalysis.suggestions],
                ].map(([label, items]: any) =>
                  Array.isArray(items) && items.length ? (
                    <div key={label}>
                      <Text strong>{label}：</Text>
                      {items.join('；')}
                    </div>
                  ) : null,
                )}
              </div>
            ) : (
              <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.8 }}>
                {benchmarkSummary}
              </div>
            )}
          </div>
        )}
      </Card>

      <div id="plan-result">
      <Card
        title="内容排版生成器"
        size="small"
        style={{ marginTop: 16 }}
        extra={
          <Space>
            <Button icon={<CopyOutlined />} onClick={copyPlan} disabled={!weeklyPlan?.rows?.length}>复制整表</Button>
            <Button icon={<ThunderboltOutlined />} loading={planLoading} onClick={() => generatePlan('weekly', false)}>
              生成 30 套周主推
            </Button>
            <Button type="primary" icon={<ThunderboltOutlined />} loading={planLoading} onClick={() => generatePlan('daily', true)}>
              DeepSeek 策划 + 豆包成稿
            </Button>
          </Space>
        }
      >
        {planLoading && (
          <div style={{ marginBottom: 12 }}>
            <Progress percent={50} status="active" showInfo={false} />
            <Text type="secondary">正在生成 30 人 × 7 天内容，请勿关闭页面，通常需要 1—5 分钟。</Text>
          </div>
        )}
        {!weeklyPlan ? (
          <Empty description="选择“周主推”或“DeepSeek 策划 + 豆包成稿”，系统会自动去重并检查违禁词" />
        ) : (
          <>
            <Alert
              type={weeklyPlan.audit?.clean ? 'success' : 'warning'}
              showIcon
              message={
                weeklyPlan.audit?.clean
                  ? `已生成 ${weeklyPlan.returned} 条内容（${weeklyPlan.generatedBy === 'dual-ai' ? 'DeepSeek 策划 + 豆包成稿' : weeklyPlan.generatedBy === 'ai' ? '大模型生成' : '安全模板生成'}），去重和违禁词检查通过`
                  : `发现 ${weeklyPlan.audit?.bannedWordCount || 0} 条风险项、${weeklyPlan.audit?.duplicatePairs?.length || 0} 条重复`
              }
              style={{ marginBottom: 12 }}
            />
            <Table
              rowKey="index"
              size="small"
              columns={planTableColumns}
              dataSource={weeklyPlan.rows || []}
              pagination={false}
              scroll={{ x: 1500, y: 520 }}
            />
          </>
        )}
      </Card>
      </div>

      <Modal
        title="重写这一条"
        open={!!rewriteRowData}
        onCancel={() => setRewriteRowData(null)}
        onOk={submitRewrite}
        confirmLoading={rewriting}
        okText="重新生成"
        cancelText="取消"
        width={560}
      >
        <div style={{ marginBottom: 12 }}>
          <Text strong>原标题：</Text>
          <Text>{rewriteRowData?.title}</Text>
        </div>
        <Input.TextArea
          value={rewriteNote}
          onChange={(e) => setRewriteNote(e.target.value)}
          placeholder="例如：语气再像女生一点；不要用“稳撤”；换成带新手的角度；结尾更自然。"
          autoSize={{ minRows: 4, maxRows: 8 }}
        />
      </Modal>
    </div>
  );
};

export default ContentCheckPage;
