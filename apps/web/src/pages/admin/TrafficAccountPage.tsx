// craftsman-ignore: TS001,TS002
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button, Space, Table, Typography, Tag, message, Modal, Form, Input, Select, Popconfirm, Row, Col, DatePicker, Tabs, Drawer, InputNumber, Statistic, Divider, List, Empty, Progress, Alert,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, DeleteOutlined, FolderOpenOutlined, SettingOutlined, FileTextOutlined, ThunderboltOutlined,
  LeftOutlined, RightOutlined, CameraOutlined, CopyOutlined,
} from '@ant-design/icons';
import { trafficAccountApi, TrafficAccountItem, TrafficNoteItem } from '../../api/trafficAccount';
import { configApi } from '../../api/config';
import { contentCheckApi } from '../../api/contentCheck';
import { useAuthStore } from '../../stores/authStore';
import { evaluateNote } from '../../utils/noteBenchmark';
import { NOTE_TEMPLATES } from '../../utils/noteTemplates';
import dayjs from 'dayjs';

const { Text, Title } = Typography;
const TYPE_COLORS: Record<string, string> = {
  抖音: 'blue', 小红书: 'volcano', 视频号: 'green', 快手: 'orange', 咸鱼: 'gold', B站: 'purple',
};
const TRAFFIC_LEVELS = ['优', '中', '差'];
const YES_NO = ['是', '否'];
const PLATFORMS = ['抖音', '小红书', '视频号', '快手', '咸鱼', 'B站'];
const ACCOUNT_ROLES = ['情绪娱乐号', '技术上分号', '避坑干货号'];
const TRACKING_EXTRA_KEYS = ['ipAddress', 'parentAccountId', 'keywords'];

interface ColumnDef { key: string; label: string; custom: boolean }

function SearchListInput({ value = [], onChange, nameKey, count = 2 }: { value?: any[]; onChange?: (v: any[]) => void; nameKey: 'word' | 'city' | 'interest'; count?: number }) {
  const rows = Array.from({ length: count }, (_, i) => i);
  const item = (i: number) => value?.[i] || { [nameKey]: '', ratio: null };
  const setItem = (i: number, patch: any) => {
    const next = [...(value || [])];
    next[i] = { ...(value?.[i] || { [nameKey]: '', ratio: null }), ...patch };
    onChange?.(next);
  };
  return (
    <div>
      {rows.map((i) => (
        <Space key={i} style={{ display: 'flex', marginBottom: 8 }}>
          <Input
            value={item(i)[nameKey] as string}
            placeholder={nameKey === 'word' ? `关键词 ${i + 1}` : nameKey === 'city' ? `城市 ${i + 1}` : `兴趣 ${i + 1}`}
            onChange={(e) => setItem(i, { [nameKey]: e.target.value })}
          />
          <InputNumber
            value={item(i).ratio ?? undefined}
            placeholder="占比%"
            min={0}
            max={100}
            step={0.1}
            style={{ width: 92 }}
            onChange={(v) => setItem(i, { ratio: v })}
          />
        </Space>
      ))}
    </div>
  );
}

function formatSearchList(items: any, key: 'word' | 'city' | 'interest'): string {
  if (!Array.isArray(items) || !items.length) return '-';
  return items.map((it: any) => {
    const name = it?.[key] ?? '';
    const ratio = it?.ratio != null ? `${it.ratio}%` : '';
    return ratio ? `${name}(${ratio})` : name;
  }).join('、');
}

const TrafficAccountPage: React.FC = () => {
  const [items, setItems] = useState<TrafficAccountItem[]>([]);
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TrafficAccountItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [colModalOpen, setColModalOpen] = useState(false);
  const [newColLabel, setNewColLabel] = useState('');
  const [activeType, setActiveType] = useState('全部');
  const [activeStatus, setActiveStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [guideOpen, setGuideOpen] = useState(false);
  const [playGuide, setPlayGuide] = useState('');
  const [guideEditing, setGuideEditing] = useState(false);
  const [guideDraft, setGuideDraft] = useState('');
  const [guideSaving, setGuideSaving] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [banAnalysisOpen, setBanAnalysisOpen] = useState(false);
  const [form] = Form.useForm();
  const authUser = useAuthStore((s) => s.user);
  const canEditGuide = authUser?.role === 'OWNER' || authUser?.role === 'ADMIN' || authUser?.role === 'CS';
  // 笔记记录
  const [noteDrawerOpen, setNoteDrawerOpen] = useState(false);
  const [noteAccount, setNoteAccount] = useState<TrafficAccountItem | null>(null);
  const [notes, setNotes] = useState<TrafficNoteItem[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<TrafficNoteItem | null>(null);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [noteForm] = Form.useForm();
  const noteFileInputRef = useRef<HTMLInputElement>(null);
  const [noteBenchmarks, setNoteBenchmarks] = useState<any>(null);
  const [liveNoteValues, setLiveNoteValues] = useState<any>({});
  // 账号计划表：对标笔记 + 内容排版生成器
  const [planOpen, setPlanOpen] = useState(false);
  const [planAccountIds, setPlanAccountIds] = useState<string[]>([]);
  const [planKeywordsMap, setPlanKeywordsMap] = useState<Record<string, string>>({});
  const [planBenchmarkJson, setPlanBenchmarkJson] = useState('');
  const [planBenchmarkNotes, setPlanBenchmarkNotes] = useState<any[]>([]);
  const [planBenchmarkSummary, setPlanBenchmarkSummary] = useState('');
  const [planBenchmarkAnalysis, setPlanBenchmarkAnalysis] = useState<any>(null);
  const [planResult, setPlanResult] = useState<any>(null);
  const [planGenerating, setPlanGenerating] = useState(false);
  const [planAnalyzing, setPlanAnalyzing] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const { data } = await configApi.get(['traffic.account_columns', 'traffic.note_benchmarks', 'traffic.play_guide']);
      const c = data?.data?.['traffic.account_columns'];
      setColumns(Array.isArray(c) && c.length ? c : []);
      setNoteBenchmarks(data?.data?.['traffic.note_benchmarks'] ?? null);
      setPlayGuide(data?.data?.['traffic.play_guide'] ?? '');
    } catch {}
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await trafficAccountApi.list();
      setItems(data.data ?? []);
    } catch {
      message.error('加载引流账号失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchItems();
  }, [fetchConfig, fetchItems]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record: TrafficAccountItem) => {
    setEditing(record);
    // 先清空表单，再填当前记录，避免上一个账号的 WiFi 备注等字段残留到下一个账号。
    form.resetFields();
    const extraValues: Record<string, any> = { ...(record.extra || {}) };
    if (extraValues.purchaseDate) extraValues.purchaseDate = dayjs(extraValues.purchaseDate);
    form.setFieldsValue({
      ...record,
      registerDate: record.registerDate ? dayjs(record.registerDate) : null,
      banDate: record.banDate ? dayjs(record.banDate) : null,
      ...extraValues,
    });
    setModalOpen(true);
  };

  const openReplace = async (record: TrafficAccountItem) => {
    setSubmitting(true);
    try {
      await trafficAccountApi.create({
        type: record.type,
        code: record.code || '',
        nickname: `${record.nickname}（新号待填）`,
        accountRole: record.accountRole || '',
        userId: record.userId,
        promotionContact: record.promotionContact || '',
        extra: {
          ipAddress: '',
          keywords: (record.extra as any)?.keywords || '',
          parentAccountId: record.id,
        },
      });
      await trafficAccountApi.update(record.id, { status: 'INACTIVE' });
      message.success('已换号：旧账号已保留，新账号已创建');
      fetchItems();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '换号失败');
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    const nextValues = values;
    const extra: Record<string, any> = {};
    const base: any = {};
    for (const [k, v] of Object.entries(nextValues)) {
      const col = columns.find((c) => c.key === k);
      if (col?.custom || TRACKING_EXTRA_KEYS.includes(k)) {
        extra[k] = k === 'purchaseDate' && v ? dayjs(v as any).format('YYYY-MM-DD') : v;
      }
      else if (k === 'registerDate' || k === 'banDate') base[k] = v ? dayjs(v as any).format('YYYY-MM-DD') : null;
      else base[k] = v;
    }
    const payload = { ...base, extra };
    setSubmitting(true);
    try {
      if (editing) {
        await trafficAccountApi.update(editing.id, payload);
        message.success('已更新');
      } else {
        await trafficAccountApi.create(payload);
        message.success('已添加');
      }
      setModalOpen(false);
      fetchItems();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const addColumn = async () => {
    const label = newColLabel.trim();
    if (!label) return;
    if (columns.some((c) => c.label === label)) { message.warning('该列已存在'); return; }
    const key = `c_${Date.now().toString(36)}`;
    const updated = [...columns, { key, label, custom: true }];
    setColumns(updated);
    await configApi.update({ 'traffic.account_columns': updated });
    setNewColLabel('');
    message.success('列已添加');
  };

  const removeColumn = async (key: string) => {
    const updated = columns.filter((c) => c.key !== key);
    setColumns(updated);
    await configApi.update({ 'traffic.account_columns': updated });
  };

  const moveColumn = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= columns.length) return;
    const updated = [...columns];
    [updated[index], updated[target]] = [updated[target], updated[index]];
    setColumns(updated);
    await configApi.update({ 'traffic.account_columns': updated });
  };

  const openFolder = (path?: string | null) => {
    if (!path) { message.warning('请先填写图片文件夹路径'); return; }
    const api = (window as any).electronAPI;
    if (api?.openFolder) api.openFolder(path).catch(() => message.info(`文件夹路径：${path}`));
    else { navigator.clipboard?.writeText(path); message.info(`已复制文件夹路径：${path}`); }
  };

  // ── 笔记记录 ──
  const openNotes = (record: TrafficAccountItem) => {
    setNoteAccount(record);
    setNoteDrawerOpen(true);
    setAnalysis(null);
    loadNotes(record.id);
  };

  const planableAccounts = React.useMemo(
    () => items
      .filter((it) => it.status !== 'INACTIVE' && it.type === '小红书')
      .sort((a, b) => (a.code?.trim() || a.nickname).localeCompare(b.code?.trim() || b.nickname, 'zh-CN', { numeric: true })),
    [items],
  );

  const openPlanGenerator = (record?: TrafficAccountItem | null) => {
    const initialIds = record?.id
      ? [record.id]
      : planableAccounts.slice(0, 3).map((a) => a.id);
    setPlanAccountIds(initialIds);
    const nextMap: Record<string, string> = {};
    initialIds.forEach((id) => {
      const acc = items.find((it) => it.id === id);
      nextMap[id] = acc?.extra?.keywords || acc?.nickname || '';
    });
    setPlanKeywordsMap(nextMap);
    setPlanBenchmarkJson('');
    setPlanBenchmarkNotes([]);
    setPlanBenchmarkSummary('');
    setPlanBenchmarkAnalysis(null);
    setPlanResult(null);
    setPlanOpen(true);
  };

  const selectedPlanAccounts = React.useMemo(
    () => planAccountIds.map((id) => items.find((it) => it.id === id)).filter(Boolean) as TrafficAccountItem[],
    [items, planAccountIds],
  );

  const buildPlanKeywords = () =>
    selectedPlanAccounts.map((acc) => (planKeywordsMap[acc.id] || acc.extra?.keywords || acc.nickname || '三角洲散陪').trim());

  const analyzePlanBenchmark = async () => {
    const text = planBenchmarkJson.trim();
    if (!text) {
      message.warning('请先粘贴从浏览器扩展复制出来的对标笔记 JSON');
      return;
    }
    let notes: any[];
    try {
      notes = JSON.parse(text);
    } catch {
      message.error('JSON 格式不对，请从扩展里点“复制 JSON”后原样粘贴');
      return;
    }
    if (!Array.isArray(notes) || notes.length < 3) {
      message.warning('至少需要 3 条笔记');
      return;
    }
    setPlanAnalyzing(true);
    try {
      const { data } = await contentCheckApi.benchmarkAnalyze({ notes });
      setPlanBenchmarkNotes(notes);
      setPlanBenchmarkSummary(data.data?.benchmarkSummary || '');
      setPlanBenchmarkAnalysis(data.data?.benchmarkAnalysis || null);
      message.success('已拆解出爆款规律，请确认后生成计划');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '拆解失败');
    } finally {
      setPlanAnalyzing(false);
    }
  };

  const generateAccountPlan = async () => {
    if (!selectedPlanAccounts.length) {
      message.warning('请先选择要生成计划的账号');
      return;
    }
    const keywords = buildPlanKeywords();
    if (keywords.some((k) => !k)) {
      message.warning('每个账号都请填写关键词');
      return;
    }

    setPlanGenerating(true);
    try {
      let plan: any;
      if (planBenchmarkNotes.length) {
        const { data } = await contentCheckApi.benchmarkGenerate({
          count: selectedPlanAccounts.length,
          notes: planBenchmarkNotes,
          keywords,
          benchmarkSummary: planBenchmarkSummary,
        });
        plan = data.data?.plan || data.data || null;
      } else {
        const { data } = await contentCheckApi.generatePlan({
          count: selectedPlanAccounts.length,
          mode: 'daily',
          useAi: true,
          keywords,
        });
        plan = data.data || null;
      }
      if (!plan) throw new Error('空结果');
      setPlanResult(plan);
      message.success(`已生成 ${selectedPlanAccounts.length} 个账号 × 7 天计划表`);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '生成失败');
    } finally {
      setPlanGenerating(false);
    }
  };

  const accountForPlanRow = (row: any) => {
    const idx = Number(row?.accountNo || row?.index || 1) - 1;
    return selectedPlanAccounts[idx] || selectedPlanAccounts[0] || null;
  };

  const copyPlanTable = async () => {
    const rows = planResult?.rows || [];
    if (!rows.length) return;
    const headers = ['账号', '星期', '核心长尾词', '人设/方向', '建议时间', '标题', '文案', '话题', '封面构图', '配图建议'];
    const lines = rows.map((r: any) => {
      const acc = accountForPlanRow(r);
      const label = acc ? `${acc.code || ''} ${acc.nickname}`.trim() : (r.accountNo || r.index);
      return [
        label,
        r.day || '',
        r.targetKeyword || '',
        r.persona || '',
        r.suggestedTime || '',
        r.title || '',
        r.body || '',
        r.topics || '',
        r.coverPlan || '',
        r.imagePlan || '',
      ].join('\t');
    });
    try {
      await navigator.clipboard.writeText([headers.join('\t'), ...lines].join('\n'));
      message.success('已复制整张计划表');
    } catch {
      message.error('复制失败，请手动选择表格复制');
    }
  };

  const loadNotes = async (accountId: string) => {
    setNotesLoading(true);
    try {
      const { data } = await trafficAccountApi.listNotes(accountId);
      setNotes((data.data as any)?.notes ?? []);
    } catch {
      message.error('加载笔记失败');
    } finally {
      setNotesLoading(false);
    }
  };

  const openNoteCreate = () => {
    setEditingNote(null);
    noteForm.resetFields();
    setLiveNoteValues({});
    setNoteModalOpen(true);
  };

  const openNoteEdit = (record: TrafficNoteItem) => {
    setEditingNote(record);
    noteForm.resetFields();
    const next = {
      ...record,
      publishDate: record.publishDate ? dayjs(record.publishDate) : null,
    };
    noteForm.setFieldsValue(next);
    setLiveNoteValues(next);
    setNoteModalOpen(true);
  };

  const submitNote = async () => {
    const values = await noteForm.validateFields();
    const payload = {
      ...values,
      publishDate: values.publishDate ? dayjs(values.publishDate).format('YYYY-MM-DD') : null,
    };
    setNoteSubmitting(true);
    try {
      if (editingNote) {
        await trafficAccountApi.updateNote(editingNote.id, payload);
        message.success('笔记已更新');
      } else {
        await trafficAccountApi.createNote(noteAccount!.id, payload);
        message.success('笔记已添加');
      }
      setNoteModalOpen(false);
      if (noteAccount) loadNotes(noteAccount.id);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setNoteSubmitting(false);
    }
  };

  const doAnalyze = async () => {
    if (!noteAccount) return;
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const { data } = await trafficAccountApi.analyzeNotes(noteAccount.id);
      setAnalysis(data.data ?? null);
    } catch {
      message.error('分析失败');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRecognizeFile = async (file: File) => {
    if (!file) return;
    setRecognizing(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || '');
          const comma = dataUrl.indexOf(',');
          resolve(comma >= 0 ? dataUrl.slice(comma + 1) : '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      if (!base64) { message.warning('图片读取失败'); return; }
      const { data } = await trafficAccountApi.recognizeNote(base64, file.type || 'image/png');
      const result = data.data ?? {};
      // 只回填识别到的非空字段，避免覆盖已填好的内容
      const patch: Record<string, any> = {};
      const numericKeys = ['exposure', 'views', 'clickRate', 'interactionRate', 'followRatio', 'dmRate', 'likes', 'comments', 'favorites', 'homeRecommendRatio', 'searchRatio', 'profileRatio'];
      for (const k of numericKeys) {
        if (result[k] != null) patch[k] = result[k];
      }
      if (result.title) patch.title = result.title;
      noteForm.setFieldsValue(patch);
      message.success('识别完成，请核对后再保存');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '识别失败，请确认已在设置里配置豆包 API Key');
    } finally {
      setRecognizing(false);
    }
  };

  const onNotePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || []);
    const item = items.find((i) => i.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) {
      e.preventDefault();
      handleRecognizeFile(file);
    }
  };

  const openGuide = () => {
    setGuideEditing(false);
    setGuideOpen(true);
  };

  const startGuideEdit = () => {
    setGuideDraft(playGuide);
    setGuideEditing(true);
  };

  const saveGuide = async () => {
    setGuideSaving(true);
    try {
      await trafficAccountApi.savePlayGuide(guideDraft);
      setPlayGuide(guideDraft);
      setGuideEditing(false);
      message.success('打法指南已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setGuideSaving(false);
    }
  };

  const renderField = (col: ColumnDef, r: TrafficAccountItem): React.ReactNode => {
    const v = col.custom ? r.extra?.[col.key] : (r as any)[col.key];
    if (col.key === 'type') return <Tag color={TYPE_COLORS[v] || 'default'} style={{ fontSize: 9, lineHeight: '16px', padding: '0 4px' }}>{v}</Tag>;
    if (col.key === 'trafficLevel') return v ? <Tag color={v === '优' ? 'green' : v === '中' ? 'gold' : 'red'}>{v}</Tag> : '-';
    if (col.key === 'riskPopped') return v === '是' ? <Tag color="red">是</Tag> : v === '否' ? <Tag color="green">否</Tag> : '-';
    if (col.key === 'banned') return v === '是' ? <Tag color="red">是</Tag> : v === '否' ? <Tag color="green">否</Tag> : '-';
    if (col.key === 'accountId') return v ? <Text copyable style={{ whiteSpace: 'nowrap' }}>{v}</Text> : '-';
    if (col.key === 'phone') return v ? <Text style={{ whiteSpace: 'nowrap' }}>{v}</Text> : '-';
    const remarkKeys = ['wifiNote', 'riskNote', 'banNote', 'imageSourceNote', 'otherNote'];
    if (!remarkKeys.includes(col.key)) {
      return <span style={{ whiteSpace: 'nowrap' }}>{v || '-'}</span>;
    }
    if (col.key === 'imageSourceNote') return (
      <Space size={4}>
        <Text ellipsis style={{ maxWidth: 90 }}>{v || '-'}</Text>
        <Button size="small" type="link" icon={<FolderOpenOutlined />} onClick={() => openFolder(r.imageFolder)}>文件夹</Button>
      </Space>
    );
    return v || '-';
  };

  const roleColumn = {
    title: '人设', key: '__role', width: 72,
    render: (_: unknown, r: TrafficAccountItem) =>
      r.accountRole
        ? <Tag color={r.accountRole === '情绪娱乐号' ? 'volcano' : r.accountRole === '技术上分号' ? 'blue' : 'cyan'}>{r.accountRole}</Tag>
        : '-',
  };

  const keywordColumn = {
    title: '关键词', key: '__keywords', width: 90,
    render: (_: unknown, r: TrafficAccountItem) => <span style={{ whiteSpace: 'nowrap' }}>{r.extra?.keywords || '-'}</span>,
  };

  const tableColumns = [
    {
      title: '序号', key: '__index', width: 24, fixed: 'left' as const,
      render: (_: unknown, __: TrafficAccountItem, index: number) => <span className="idx-cell">{index + 1}</span>,
    },
    ...columns.flatMap((col) => {
      const mapped = {
        title: col.key === 'code' ? '矩阵手机编号' : col.label,
        key: col.key,
        dataIndex: col.custom ? undefined : col.key,
        width: ['wifiNote', 'riskNote', 'banNote', 'imageSourceNote', 'otherNote'].includes(col.key)
          ? (col.key === 'riskNote' ? 110 : 72)
          : col.key === 'accountId'
            ? 72
            : col.key === 'code'
              ? 90
            : col.key === 'phone'
              ? 85
              : col.key === 'type'
                ? 50
                : ['registerDate', 'banDate', 'purchaseDate'].includes(col.key)
                  ? 80
                  : 40,
        render: (_: unknown, r: TrafficAccountItem) => renderField(col, r),
      };
      return col.key === 'trafficLevel' ? [mapped, keywordColumn, roleColumn] : [mapped];
    }),
    {
      title: 'IP', key: '__ip', width: 78,
      render: (_: unknown, r: TrafficAccountItem) => <span style={{ whiteSpace: 'nowrap' }}>{r.extra?.ipAddress || '-'}</span>,
    },
    {
      title: '归属客服', key: '__owner', width: 45,
      render: (_: unknown, r: TrafficAccountItem) => <span style={{ whiteSpace: 'nowrap' }}>{r.user?.displayName || r.user?.username || '-'}</span>,
    },
    {
      title: '操作', key: 'actions', width: 122, fixed: 'right' as const,
      render: (_: unknown, r: TrafficAccountItem) => (
        <Space size={4}>
          <Button size="small" style={{ fontSize: 9, height: 20, padding: '0 4px' }} icon={<FileTextOutlined />} onClick={() => openNotes(r)}>笔记</Button>
          <Button size="small" style={{ fontSize: 9, height: 20, padding: '0 4px' }} onClick={() => openEdit(r)}>编辑</Button>
          {r.status !== 'INACTIVE' && (
            <Popconfirm title="确定换号？系统会直接新建一个同编号手机的新账号，并把当前账号保存为已弃用。" onConfirm={() => openReplace(r)}>
              <Button size="small" style={{ fontSize: 9, height: 20, padding: '0 4px' }}>换号</Button>
            </Popconfirm>
          )}
          <Popconfirm title="确定彻底删除？删除后该账号记录将无法找回。" onConfirm={async () => { await trafficAccountApi.remove(r.id); fetchItems(); }}>
            <Button size="small" danger icon={<DeleteOutlined />} style={{ fontSize: 9, height: 20, padding: '0 4px' }}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 正常账号和已弃用账号分开显示；当前视图内再按编号顺序排列。
  const sortedItems = React.useMemo(() => {
    const list = items
      .filter((it) => it.status === activeStatus)
      .filter((it) => activeType === '全部' || it.type === activeType);
    return [...list].sort((a, b) => {
      const aCode = a.code?.trim() || 'ZZZZ';
      const bCode = b.code?.trim() || 'ZZZZ';
      return aCode.localeCompare(bCode, 'zh-CN', { numeric: true });
    });
  }, [items, activeType, activeStatus]);

  const banAnalysis = React.useMemo(() => {
    const buildGroups = (key: 'code' | 'ipAddress') => {
      const map = new Map<string, { count: number; latest: string; accounts: string[] }>();
      const bannedOrReplaced = items.filter((it) => it.banned === '是' || it.status === 'INACTIVE');
      for (const it of bannedOrReplaced) {
        const target = key === 'code'
          ? String(it.code || '').trim()
          : String((it.extra as any)?.ipAddress || '').trim();
        if (!target) continue;
        const current = map.get(target) || { count: 0, latest: '', accounts: [] };
        current.count += 1;
        current.accounts.push(`${it.nickname}${it.accountId ? `(${it.accountId})` : ''}`);
        const dateText = it.banDate || (it.updatedAt ? dayjs(it.updatedAt).format('YYYY-MM-DD') : '');
        if (dateText && (!current.latest || dateText > current.latest)) current.latest = dateText;
        map.set(target, current);
      }
      return Array.from(map.entries())
        .map(([target, value]) => ({
          key: target,
          target,
          count: value.count,
          latest: value.latest || '-',
          accounts: value.accounts.join('、'),
        }))
        .sort((a, b) => b.count - a.count);
    };
    return {
      deviceRows: buildGroups('code'),
      ipRows: buildGroups('ipAddress'),
    };
  }, [items]);

  const liveEval = evaluateNote(liveNoteValues, noteBenchmarks);
  const overdueFailingIds = React.useMemo(() => {
    const cutoff = Date.now() - 48 * 3600 * 1000;
    const set = new Set<string>();
    for (const note of notes) {
      const pd = note.publishDate ? new Date(note.publishDate).getTime() : null;
      if (pd != null && pd < cutoff) {
        const ev = evaluateNote(note, noteBenchmarks);
        if (ev.some((e) => e.level === 'red')) set.add(note.id);
      }
    }
    return set;
  }, [notes, noteBenchmarks]);

  const activeCount = items.filter((it) => it.status !== 'INACTIVE').length;
  const inactiveCount = items.filter((it) => it.status === 'INACTIVE').length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>工作室账号管理</Title>
          <Text type="secondary">按平台管理抖音、小红书、视频号、快手、咸鱼、B站账号</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchItems} loading={loading}>刷新</Button>
          <Button icon={<FileTextOutlined />} onClick={openGuide}>打法指南</Button>
          <Button icon={<SettingOutlined />} onClick={() => setColModalOpen(true)}>列设置</Button>
          <Button onClick={() => setBanAnalysisOpen(true)}>封号分析</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加账号</Button>
        </Space>
      </div>
      <Tabs
        activeKey={activeStatus}
        onChange={(key) => setActiveStatus(key as 'ACTIVE' | 'INACTIVE')}
        size="small"
        items={[
          { key: 'ACTIVE', label: `正常账号 (${activeCount})` },
          { key: 'INACTIVE', label: `已弃用账号 (${inactiveCount})` },
        ]}
        style={{ marginBottom: 8 }}
      />
      <Tabs
        activeKey={activeType}
        onChange={setActiveType}
        size="small"
        items={[
          { key: '全部', label: '全部' },
          ...PLATFORMS.map((p) => ({ key: p, label: p })),
        ]}
        style={{ marginBottom: 8 }}
      />
      <style>{`.ant-table-tbody > tr > td, .ant-table-thead > tr > th { padding: 2px 2px !important; font-size: 10px !important; color: #111827 !important; } .ant-table * { font-size: 10px !important; } .ant-tag { font-size: 9px !important; line-height: 16px !important; } .idx-cell { font-size: 9px !important; } .note-row-danger > td { background: #fff1f0 !important; } .traffic-account-form .ant-form-item { margin-bottom: 6px !important; }`}</style>
      <div style={{ fontSize: 10 }}>
        <Table rowKey="id" columns={tableColumns} dataSource={sortedItems} loading={loading} size="small" pagination={false} />
      </div>

      {/* 账号编辑/新增 */}
      <Modal
        title={editing ? '编辑引流账号' : '添加引流账号'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={submitting}
        width={760}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="traffic-account-form">
          <Row gutter={6}>
            <Col span={8}><Form.Item name="type" label="平台" rules={[{ required: true, message: '请选择平台' }]}><Select options={PLATFORMS.map((t) => ({ value: t, label: t }))} placeholder="选择平台" /></Form.Item></Col>
            <Col span={8}><Form.Item name="code" label="矩阵手机编号"><Input placeholder="例如 XHS-1" /></Form.Item></Col>
            <Col span={8}><Form.Item name="trafficLevel" label="流量"><Select options={TRAFFIC_LEVELS.map((v) => ({ value: v, label: v }))} placeholder="优/中/差" allowClear /></Form.Item></Col>
            <Col span={8}><Form.Item name="ipAddress" label="IP"><Input placeholder="手动填写当前 IP" /></Form.Item></Col>
            <Col span={8}><Form.Item name="keywords" label="关键词"><Input placeholder="例如 三角洲 / 上分" /></Form.Item></Col>
            <Col span={8}><Form.Item name="accountRole" label="人设"><Select options={ACCOUNT_ROLES.map((v) => ({ value: v, label: v }))} placeholder="情绪娱乐/技术上分/避坑干货" allowClear /></Form.Item></Col>
            <Col span={8}><Form.Item name="nickname" label="昵称" rules={[{ required: true, message: '请输入昵称' }]}><Input placeholder="昵称" /></Form.Item></Col>
            <Col span={8}><Form.Item name="accountId" label="ID"><Input placeholder="账号ID / 主页链接" /></Form.Item></Col>
            <Col span={8}><Form.Item name="wifi" label="WiFi"><Input placeholder="WiFi名称" /></Form.Item></Col>
            <Col span={8}><Form.Item name="wifiNote" label="WiFi备注"><Input placeholder="备注" /></Form.Item></Col>
            <Col span={8}><Form.Item name="wifiRegion" label="WiFi地区"><Input placeholder="例如 杭州" /></Form.Item></Col>
            <Col span={8}><Form.Item name="purchaseDate" label="购买时间"><DatePicker style={{ width: '100%' }} placeholder="选择购买时间" /></Form.Item></Col>
            <Col span={8}><Form.Item name="riskPopped" label="是否弹过风险"><Select options={YES_NO.map((v) => ({ value: v, label: v }))} allowClear /></Form.Item></Col>
            <Col span={8}><Form.Item name="riskNote" label="风险备注"><Input placeholder="风险说明" /></Form.Item></Col>
            <Col span={8}><Form.Item name="banned" label="是否封禁过"><Select options={YES_NO.map((v) => ({ value: v, label: v }))} allowClear /></Form.Item></Col>
            <Col span={8}><Form.Item name="banNote" label="封禁备注"><Input placeholder="封禁说明" /></Form.Item></Col>
            <Col span={8}><Form.Item name="phone" label="注册手机号"><Input placeholder="手机号" /></Form.Item></Col>
            <Col span={8}><Form.Item name="promotionContact" label="地推联系人"><Input placeholder="地推联系人" /></Form.Item></Col>
            <Col span={8}><Form.Item name="realName" label="实名"><Input placeholder="实名姓名" /></Form.Item></Col>
            <Col span={8}><Form.Item name="realNameAge" label="实名年龄"><InputNumber style={{ width: '100%' }} min={0} max={100} placeholder="年龄" /></Form.Item></Col>
            <Col span={8}><Form.Item name="realNameGender" label="实名性别"><Select options={[{ value: '男', label: '男' }, { value: '女', label: '女' }]} allowClear placeholder="性别" /></Form.Item></Col>
            <Col span={8}><Form.Item name="followers" label="粉丝数"><InputNumber style={{ width: '100%' }} min={0} placeholder="粉丝数" /></Form.Item></Col>
            <Col span={8}><Form.Item name="registerDate" label="注册日期"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="banDate" label="封禁日期"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="imageSourceNote" label="图片来源备注"><Input placeholder="图片来源说明" /></Form.Item></Col>
            <Col span={12}><Form.Item name="imageFolder" label="本地图片文件夹"><Input addonAfter={<Button type="link" size="small" icon={<FolderOpenOutlined />} onClick={() => openFolder(form.getFieldValue('imageFolder'))} style={{ padding: 0 }} />} placeholder="本地文件夹路径" /></Form.Item></Col>
            <Col span={24}><Form.Item name="otherNote" label="其他备注"><Input.TextArea rows={2} placeholder="其他备注" /></Form.Item></Col>
            {columns.filter((c) => c.custom).map((c) => (
              <Col span={12} key={c.key}><Form.Item name={c.key} label={c.label}><Input placeholder={`填写 ${c.label}`} /></Form.Item></Col>
            ))}
          </Row>
        </Form>
      </Modal>

      {/* 封号分析 */}
      <Drawer
        title="封号分析"
        open={banAnalysisOpen}
        onClose={() => setBanAnalysisOpen(false)}
        width={820}
      >
        <Text type="secondary">统计口径：是否封禁过 = 是，或账号已弃用。</Text>
        <Divider style={{ margin: '12px 0' }} />
        <Title level={5} style={{ margin: 0 }}>按矩阵手机编号统计</Title>
        <Table
          rowKey="key"
          size="small"
          pagination={false}
          dataSource={banAnalysis.deviceRows}
          locale={{ emptyText: '还没有填写矩阵手机编号的历史封号记录' }}
          columns={[
            { title: '矩阵手机编号', dataIndex: 'target', width: 130 },
            { title: '封号/换号次数', dataIndex: 'count', width: 120, render: (v: number) => <Tag color={v >= 3 ? 'red' : v === 2 ? 'orange' : 'default'}>{v}</Tag> },
            { title: '最近记录', dataIndex: 'latest', width: 120 },
            { title: '历史账号', dataIndex: 'accounts', ellipsis: true },
          ]}
        />
        <Divider style={{ margin: '16px 0 12px' }} />
        <Title level={5} style={{ margin: 0 }}>按 IP 统计</Title>
        <Table
          rowKey="key"
          size="small"
          pagination={false}
          dataSource={banAnalysis.ipRows}
          locale={{ emptyText: '还没有填写 IP 的历史封号记录' }}
          columns={[
            { title: 'IP', dataIndex: 'target', width: 150 },
            { title: '封号/换号次数', dataIndex: 'count', width: 120, render: (v: number) => <Tag color={v >= 3 ? 'red' : v === 2 ? 'orange' : 'default'}>{v}</Tag> },
            { title: '最近记录', dataIndex: 'latest', width: 120 },
            { title: '历史账号', dataIndex: 'accounts', ellipsis: true },
          ]}
        />
      </Drawer>

      {/* 笔记记录抽屉 */}
      <Drawer
        title={`${noteAccount?.nickname || '账号'} · 笔记记录`}
        open={noteDrawerOpen}
        onClose={() => setNoteDrawerOpen(false)}
        width={860}
        extra={
          <Space>
            <Button icon={<ThunderboltOutlined />} onClick={() => openPlanGenerator(noteAccount)}>计划表</Button>
            <Button icon={<FileTextOutlined />} onClick={() => setTemplateOpen(true)}>文案模板</Button>
            <Button icon={<ThunderboltOutlined />} onClick={doAnalyze} loading={analyzing}>AI 分析</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openNoteCreate}>添加笔记</Button>
          </Space>
        }
      >
        {analysis && (
          <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <Text strong style={{ color: '#389e0d' }}>AI 分析报告</Text>
            <Row gutter={8} style={{ marginTop: 8 }}>
              <Col span={6}><Statistic title="笔记数" value={analysis.summary?.noteCount ?? 0} /></Col>
              <Col span={6}><Statistic title="总曝光" value={analysis.summary?.totalExposure ?? 0} /></Col>
              <Col span={6}><Statistic title="总浏览" value={analysis.summary?.totalViews ?? 0} /></Col>
              <Col span={6}><Statistic title="平均浏览" value={analysis.summary?.avgViews ?? 0} /></Col>
            </Row>
            <Row gutter={8} style={{ marginTop: 4 }}>
              <Col span={6}><Statistic title="平均点击率" value={`${analysis.summary?.avgCtr ?? 0}%`} /></Col>
              <Col span={6}><Statistic title="平均互动率" value={`${analysis.summary?.avgInteractionRate ?? 0}%`} /></Col>
              <Col span={6}><Statistic title="平均涨粉率" value={`${analysis.summary?.avgFollowRate ?? 0}%`} /></Col>
              <Col span={6}><Statistic title="平均私信率" value={`${analysis.summary?.avgDmRate ?? 0}%`} /></Col>
            </Row>
            <Row gutter={8} style={{ marginTop: 4 }}>
              <Col span={8}><Statistic title="首页推荐均值" value={`${analysis.summary?.avgHomeRecommendRatio ?? 0}%`} /></Col>
              <Col span={8}><Statistic title="搜索均值" value={`${analysis.summary?.avgSearchRatio ?? 0}%`} /></Col>
              <Col span={8}><Statistic title="个人主页均值" value={`${analysis.summary?.avgProfileRatio ?? 0}%`} /></Col>
            </Row>
            <Divider style={{ margin: '8px 0' }} />
            {analysis.aiAdvice && (
              <>
                <Text strong style={{ color: '#1677ff' }}>AI 建议</Text>
                <div style={{ whiteSpace: 'pre-wrap', background: '#fff', border: '1px solid #e6f4ff', borderRadius: 6, padding: 8, marginTop: 6 }}>
                  {analysis.aiAdvice}
                </div>
                <Divider style={{ margin: '8px 0' }} />
              </>
            )}
            <List
              size="small"
              dataSource={analysis.conclusions || []}
              renderItem={(c: string) => <List.Item style={{ padding: '4px 0' }}><Text>• {c}</Text></List.Item>}
            />
            {Array.isArray(analysis.evaluation) && analysis.evaluation.length > 0 && (
              <>
                <Divider style={{ margin: '8px 0' }} />
                <Text strong style={{ color: '#d46b08' }}>判级明细（48 小时底线）</Text>
                <div style={{ marginTop: 6 }}>
                  {analysis.evaluation.map((e: any) => (
                    <div key={e.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                      <Tag color={e.level === 'red' ? 'red' : e.level === 'orange' ? 'orange' : e.level === 'blue' ? 'blue' : 'green'} style={{ margin: 0, flexShrink: 0 }}>{e.tier}</Tag>
                      <Text style={{ fontSize: 12, lineHeight: '20px' }}>
                        <b>{e.label}</b> {e.value != null ? `${e.value}%` : '-'}：{e.hint}
                      </Text>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {overdueFailingIds.size > 0 && (
          <div style={{ background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
            <Text strong style={{ color: '#cf1322' }}>⚠️ 有 {overdueFailingIds.size} 条笔记已发布超 48 小时仍在淘汰档，建议换封面/标题重写（下方已标红）。</Text>
          </div>
        )}
        <Table
          rowKey="id"
          size="small"
          loading={notesLoading}
          pagination={false}
          dataSource={notes}
          rowClassName={(r: TrafficNoteItem) => overdueFailingIds.has(r.id) ? 'note-row-danger' : ''}
          locale={{ emptyText: '还没有笔记，点右上角「添加笔记」录入' }}
          columns={[
            { title: '发布时间', dataIndex: 'publishDate', width: 90, render: (v: string) => v ? dayjs(v).format('MM-DD') : '-' },
            { title: '标题', dataIndex: 'title', width: 150, render: (v: string) => v || '-' },
            { title: '状态', key: '__status', width: 62, fixed: 'left' as const, render: (_: unknown, r: TrafficNoteItem) =>
              overdueFailingIds.has(r.id) ? <Tag color="red">待优化</Tag> : <Tag color="green">正常</Tag> },
            { title: '曝光', dataIndex: 'exposure', width: 70, render: (v: number) => v ?? '-' },
            { title: '观看', dataIndex: 'views', width: 70, render: (v: number) => v ?? '-' },
            { title: '点击率', dataIndex: 'clickRate', width: 65, render: (v: number) => v != null ? `${v}%` : '-' },
            { title: '互动率', dataIndex: 'interactionRate', width: 65, render: (v: number) => v != null ? `${v}%` : '-' },
            { title: '涨粉率', dataIndex: 'followRatio', width: 65, render: (v: number) => v != null ? `${v}%` : '-' },
            { title: '私信率', dataIndex: 'dmRate', width: 65, render: (v: number) => v != null ? `${v}%` : '-' },
            { title: '阅读完成率', dataIndex: 'readCompletionRate', width: 80, render: (v: number) => v != null ? `${v}%` : '-' },
            { title: '点赞', dataIndex: 'likes', width: 55, render: (v: number) => v ?? '-' },
            { title: '评论', dataIndex: 'comments', width: 55, render: (v: number) => v ?? '-' },
            { title: '收藏', dataIndex: 'favorites', width: 55, render: (v: number) => v ?? '-' },
            { title: '首页推荐', dataIndex: 'homeRecommendRatio', width: 70, render: (v: number) => v != null ? `${v}%` : '-' },
            { title: '搜索', dataIndex: 'searchRatio', width: 60, render: (v: number) => v != null ? `${v}%` : '-' },
            { title: '个人主页', dataIndex: 'profileRatio', width: 70, render: (v: number) => v != null ? `${v}%` : '-' },
            { title: '搜索热词', dataIndex: 'searchKeywords', width: 130, render: (v: any) => formatSearchList(v, 'word') },
            { title: '城市分布', dataIndex: 'cityDist', width: 120, render: (v: any) => formatSearchList(v, 'city') },
            { title: '兴趣分布', dataIndex: 'interests', width: 100, render: (v: any) => formatSearchList(v, 'interest') },
            { title: '备注', dataIndex: 'note', width: 130, render: (v: string) => v || '-' },
            {
              title: '操作', key: 'actions', width: 90, fixed: 'right' as const,
              render: (_: unknown, r: TrafficNoteItem) => (
                <Space size={4}>
                  <Button size="small" style={{ fontSize: 9 }} onClick={() => openNoteEdit(r)}>编辑</Button>
                  <Popconfirm title="删除这条笔记？" onConfirm={async () => { await trafficAccountApi.removeNote(r.id); loadNotes(noteAccount!.id); }}>
                    <Button size="small" danger style={{ fontSize: 9 }}>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Drawer>

      {/* 账号计划表：对标笔记 + 内容排版生成器 */}
      <Modal
        title="账号计划表（对标笔记 + 内容排版生成器）"
        open={planOpen}
        onCancel={() => setPlanOpen(false)}
        footer={null}
        width={1180}
        destroyOnClose
      >
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Text strong style={{ flexShrink: 0 }}>选择小红书账号</Text>
            <Select
              mode="multiple"
              style={{ flex: 1 }}
              value={planAccountIds}
              placeholder="默认当前账号，可一次选多个账号生成矩阵计划"
              options={planableAccounts.map((a) => ({
                value: a.id,
                label: `${a.code || '未编号'} ${a.nickname}${a.extra?.keywords ? `（${a.extra.keywords}）` : ''}`,
              }))}
              onChange={(vals: string[]) => {
                setPlanAccountIds(vals);
                setPlanKeywordsMap((prev) => {
                  const next = { ...prev };
                  vals.forEach((id) => {
                    if (!next[id]) {
                      const acc = items.find((it) => it.id === id);
                      next[id] = acc?.extra?.keywords || '';
                    }
                  });
                  return next;
                });
              }}
            />
          </div>

          {selectedPlanAccounts.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary">按账号顺序填写关键词，生成时会一一对应到下面账号：</Text>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
                {selectedPlanAccounts.map((acc, idx) => (
                  <div key={acc.id} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 8 }}>
                    <Text strong style={{ fontSize: 12 }}>
                      {idx + 1}. {acc.code || '未编号'} {acc.nickname}
                    </Text>
                    {acc.accountRole && <Tag style={{ marginLeft: 6 }}>{acc.accountRole}</Tag>}
                    <Input
                      style={{ marginTop: 6 }}
                      placeholder="例如 三角洲散陪"
                      value={planKeywordsMap[acc.id] || ''}
                      onChange={(e) => setPlanKeywordsMap((prev) => ({ ...prev, [acc.id]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <Divider orientation="left" plain style={{ margin: '8px 0' }}>对标笔记导入</Divider>
          <Input.TextArea
            value={planBenchmarkJson}
            onChange={(e) => setPlanBenchmarkJson(e.target.value)}
            placeholder="把浏览器扩展里复制的对标笔记 JSON 原样粘贴到这里。不贴也可以，系统会用安全模板生成。"
            autoSize={{ minRows: 4, maxRows: 9 }}
          />

          <Space style={{ marginTop: 12 }} wrap>
            <Button icon={<ThunderboltOutlined />} loading={planAnalyzing} onClick={analyzePlanBenchmark}>
              先拆解建议
            </Button>
            <Button type="primary" icon={<ThunderboltOutlined />} loading={planGenerating} onClick={generateAccountPlan}>
              确认生成计划
            </Button>
            {planResult?.rows?.length > 0 && (
              <Button icon={<CopyOutlined />} onClick={copyPlanTable}>
                复制整表
              </Button>
            )}
          </Space>

          {planBenchmarkSummary && (
            <div style={{ marginTop: 12, padding: 12, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8 }}>
              <Text strong style={{ color: '#389e0d' }}>已拆解出的爆款规律</Text>
              {planBenchmarkAnalysis ? (
                <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.8 }}>
                  {[
                    ['标题公式', planBenchmarkAnalysis.titleFormulas],
                    ['开头钩子', planBenchmarkAnalysis.openingHooks],
                    ['正文结构', planBenchmarkAnalysis.bodyStructure],
                    ['封面特点', planBenchmarkAnalysis.coverFeatures],
                    ['话题选择', planBenchmarkAnalysis.topics],
                    ['建议长尾词', planBenchmarkAnalysis.keywords],
                    ['下一步建议', planBenchmarkAnalysis.suggestions],
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
                  {planBenchmarkSummary}
                </div>
              )}
            </div>
          )}

          {planGenerating && (
            <div style={{ marginTop: 12 }}>
              <Progress percent={50} status="active" showInfo={false} />
              <Text type="secondary">正在生成计划表，请勿关闭页面，通常需要 1—5 分钟。</Text>
            </div>
          )}

          {planResult?.rows?.length > 0 && (
            <>
              <Divider orientation="left" plain style={{ margin: '12px 0 8px' }}>每日计划表</Divider>
              {planResult.audit && !planResult.audit.clean && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message={`发现 ${planResult.audit.bannedWordCount || 0} 条风险项、${planResult.audit.duplicatePairs?.length || 0} 条重复，建议先调整后再发布`}
                />
              )}
              <Table
                rowKey={(r: any) => `${r.accountNo}-${r.day}-${r.index}`}
                size="small"
                pagination={false}
                scroll={{ x: 1600, y: 480 }}
                dataSource={planResult.rows || []}
                columns={[
                  {
                    title: '账号', key: 'account', width: 150, fixed: 'left' as const,
                    render: (_: unknown, r: any) => {
                      const acc = accountForPlanRow(r);
                      return acc ? (
                        <span style={{ whiteSpace: 'nowrap' }}>
                          {acc.code ? `${acc.code} ` : ''}{acc.nickname}
                        </span>
                      ) : (r.accountNo || r.index);
                    },
                  },
                  { title: '星期', dataIndex: 'day', width: 58 },
                  { title: '核心长尾词', dataIndex: 'targetKeyword', width: 135 },
                  { title: '人设/方向', dataIndex: 'persona', width: 130 },
                  { title: '建议时间', dataIndex: 'suggestedTime', width: 100 },
                  { title: '标题', dataIndex: 'title', width: 200, render: (v: string) => <Text copyable style={{ whiteSpace: 'normal' }}>{v || '-'}</Text> },
                  { title: '文案', dataIndex: 'body', width: 340, render: (v: string) => <span style={{ whiteSpace: 'pre-wrap' }}>{v || '-'}</span> },
                  { title: '话题', dataIndex: 'topics', width: 180, render: (v: string) => <Text copyable style={{ whiteSpace: 'normal' }}>{v || '-'}</Text> },
                  { title: '封面构图', dataIndex: 'coverPlan', width: 230, render: (v: string) => v || '-' },
                  { title: '配图建议', dataIndex: 'imagePlan', width: 200, render: (v: string) => v || '-' },
                ]}
              />
            </>
          )}
        </div>
      </Modal>

      {/* 笔记编辑/新增 */}
      <Modal
        title={editingNote ? '编辑笔记' : '添加笔记'}
        open={noteModalOpen}
        onCancel={() => setNoteModalOpen(false)}
        onOk={submitNote}
        confirmLoading={noteSubmitting}
        width={720}
        destroyOnClose
      >
        <Form form={noteForm} layout="vertical" onPaste={onNotePaste} onValuesChange={(_c, all) => setLiveNoteValues(all)}>
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button icon={<CameraOutlined />} onClick={() => noteFileInputRef.current?.click()} loading={recognizing}>上传截图识别</Button>
            <Text type="secondary">粘贴（Ctrl+V）或上传小红书数据截图，自动填曝光/浏览/点赞等字段</Text>
            <input
              ref={noteFileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleRecognizeFile(f); e.target.value = ''; }}
            />
          </div>
          {liveEval.length > 0 && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8 }}>
              <Text strong style={{ fontSize: 12 }}>📊 实时判级（48 小时数据，低于及格线标红）</Text>
              <div style={{ marginTop: 6 }}>
                {liveEval.map((e) => (
                  <div key={e.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                    <Tag color={e.level === 'red' ? 'red' : e.level === 'orange' ? 'orange' : e.level === 'blue' ? 'blue' : 'green'} style={{ margin: 0, flexShrink: 0 }}>{e.tier}</Tag>
                    <Text style={{ fontSize: 12, lineHeight: '20px' }}>
                      <b>{e.label}</b> {e.value != null ? `${e.value}%` : '-'}：{e.hint}
                    </Text>
                  </div>
                ))}
              </div>
            </div>
          )}
          <Row gutter={12}>
            <Col span={8}><Form.Item name="publishDate" label="发布时间"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={16}><Form.Item name="title" label="笔记标题 / 链接"><Input placeholder="笔记标题或链接" /></Form.Item></Col>
          </Row>

          <Divider orientation="left" plain style={{ margin: '6px 0' }}>数据概览</Divider>
          <Row gutter={12}>
            <Col span={6}><Form.Item name="exposure" label="曝光量"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
            <Col span={6}><Form.Item name="views" label="观看量"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
            <Col span={6}><Form.Item name="clickRate" label="点击率 (%)"><InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} /></Form.Item></Col>
            <Col span={6}><Form.Item name="interactionRate" label="互动率 (%)"><InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} /></Form.Item></Col>
            <Col span={6}><Form.Item name="followRatio" label="涨粉率 (%)"><InputNumber style={{ width: '100%' }} min={0} max={100} step={0.01} /></Form.Item></Col>
            <Col span={6}><Form.Item name="dmRate" label="私信率 (%)"><InputNumber style={{ width: '100%' }} min={0} max={100} step={0.01} /></Form.Item></Col>
            <Col span={6}><Form.Item name="readCompletionRate" label="阅读完成率 (%)"><InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} /></Form.Item></Col>
            <Col span={6}><Form.Item name="likes" label="点赞量"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
            <Col span={6}><Form.Item name="comments" label="评论量"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
            <Col span={6}><Form.Item name="favorites" label="收藏量"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
          </Row>

          <Divider orientation="left" plain style={{ margin: '6px 0' }}>流量分析</Divider>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="homeRecommendRatio" label="首页推荐 (%)"><InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} /></Form.Item></Col>
            <Col span={8}><Form.Item name="searchRatio" label="搜索 (%)"><InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} /></Form.Item></Col>
            <Col span={8}><Form.Item name="profileRatio" label="个人主页 (%)"><InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} /></Form.Item></Col>
            <Col span={24}><Form.Item name="searchKeywords" label="搜索热词（10个+占比）"><SearchListInput nameKey="word" count={10} /></Form.Item></Col>
          </Row>

          <Divider orientation="left" plain style={{ margin: '6px 0' }}>观众分析</Divider>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="cityDist" label="城市分布（5个+占比）"><SearchListInput nameKey="city" count={5} /></Form.Item></Col>
            <Col span={12}><Form.Item name="interests" label="兴趣分布（2个+占比）"><SearchListInput nameKey="interest" count={2} /></Form.Item></Col>
            <Col span={24}><Form.Item name="note" label="备注"><Input.TextArea rows={2} placeholder="这条笔记的备注" /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      {/* 列设置：添加列 + 左右移动 */}
      <Modal title="列设置" open={colModalOpen} onCancel={() => setColModalOpen(false)} footer={null} width={520}>
        <div style={{ marginTop: 12 }}>
          <Space style={{ width: '100%', marginBottom: 12 }}>
            <Input value={newColLabel} onChange={(e) => setNewColLabel(e.target.value)} onPressEnter={addColumn} placeholder="新列名称" style={{ width: 220 }} />
            <Button type="primary" icon={<PlusOutlined />} onClick={addColumn}>添加列</Button>
          </Space>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {columns.map((c, i) => (
              <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <Text style={{ flex: 1 }}>{c.label}{c.custom ? <Tag color="cyan" style={{ marginLeft: 8 }}>自定义</Tag> : null}</Text>
                <Space size={4}>
                  <Button size="small" icon={<LeftOutlined />} disabled={i === 0} onClick={() => moveColumn(i, -1)} />
                  <Button size="small" icon={<RightOutlined />} disabled={i === columns.length - 1} onClick={() => moveColumn(i, 1)} />
                  {c.custom && <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeColumn(c.key)} />}
                </Space>
              </div>
            ))}
          </div>
          <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>左右箭头调整列顺序，自定义列可删除。</Text>
        </div>
      </Modal>

      {/* 打法指南 */}
      <Modal title="📖 打法指南（三角洲陪玩 · 小红书图文矩阵）" open={guideOpen} onCancel={() => setGuideOpen(false)} footer={null} width={720}>
        {guideEditing ? (
          <>
            <Input.TextArea
              value={guideDraft}
              onChange={(e) => setGuideDraft(e.target.value)}
              autoSize={{ minRows: 18, maxRows: 30 }}
              placeholder="输入打法指南内容，支持换行"
            />
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <Space>
                <Button onClick={() => setGuideEditing(false)}>取消</Button>
                <Button type="primary" loading={guideSaving} onClick={saveGuide}>保存</Button>
              </Space>
            </div>
          </>
        ) : (
          <>
            {canEditGuide && (
              <div style={{ textAlign: 'right', marginBottom: 8 }}>
                <Button size="small" type="primary" onClick={startGuideEdit}>编辑</Button>
              </div>
            )}
            <div style={{ fontSize: 13, lineHeight: 1.9, whiteSpace: 'pre-wrap', maxHeight: '70vh', overflowY: 'auto' }}>
              {playGuide || '暂无内容'}
            </div>
          </>
        )}
      </Modal>

      {/* 文案模板 */}
      <Modal title="📋 文案模板（三角洲陪玩）" open={templateOpen} onCancel={() => setTemplateOpen(false)} footer={null} width={720}>
        <Tabs
          size="small"
          defaultActiveKey={noteAccount?.accountRole || NOTE_TEMPLATES[0].role}
          items={NOTE_TEMPLATES.map((t) => ({
            key: t.role,
            label: t.role,
            children: (
              <div style={{ fontSize: 13, lineHeight: 1.9, maxHeight: '60vh', overflowY: 'auto' }}>
                <Text strong>标题模板（点右侧复制）</Text>
                <ul style={{ paddingLeft: 18, margin: '4px 0 12px' }}>
                  {t.titles.map((x) => <li key={x}><Text copyable style={{ whiteSpace: 'normal' }}>{x}</Text></li>)}
                </ul>
                <Text strong>封面文案</Text>
                <ul style={{ paddingLeft: 18, margin: '4px 0 12px' }}>
                  {t.coverTexts.map((x) => <li key={x}><Text copyable style={{ whiteSpace: 'normal' }}>{x}</Text></li>)}
                </ul>
                <Text strong>正文结构（3-6 张图）</Text>
                <ul style={{ paddingLeft: 18, margin: '4px 0 12px' }}>
                  {t.body.map((x) => <li key={x}>{x}</li>)}
                </ul>
                <Text strong>标签</Text>
                <div style={{ marginTop: 4 }}><Text copyable>{t.tags}</Text></div>
              </div>
            ),
          }))}
        />
      </Modal>
    </div>
  );
};

export default TrafficAccountPage;
