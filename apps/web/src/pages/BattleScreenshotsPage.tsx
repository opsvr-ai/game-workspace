// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, Button, Upload, Select, Typography, Space, Tag, message, Image, Empty, Spin } from 'antd';
import type { UploadFile } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { battleScreenshotsApi, type BattleScreenshot } from '../api/battleScreenshots';
import { customersApi } from '../api/customers';
import { companionsApi } from '../api/companions';
import { useAuthStore } from '../stores/authStore';
import PageHeader from '../components/PageHeader';
import { visibleInterval } from '../hooks/usePolling';

const { Text } = Typography;
const { Dragger } = Upload;

// 与服务端 BattleScreenshotsController 的 ALLOWED_EXTS 保持一致。
//
// 为什么按「扩展名」而不是只写 `image/*`：陪玩的真实操作是「截图 → 粘贴到微信电脑端 →
// 从微信拖进这个上传框」，微信拖出来的临时文件经常没有 MIME（file.type === ''）。
// 而 antd 的拖拽是用 accept 过滤的（rc-upload：`files.filter(f => attrAccept(f, accept))`），
// `image/*` 在 MIME 为空时匹配不上，文件就被**静默丢掉**（连 beforeUpload 都不会触发）——
// 表现就是「图拖进去了，提交按钮一直灰着」。扩展名判断不看 MIME，微信拖的和手动选的都能进。
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif', '.tif', '.tiff'];
const IMAGE_ACCEPT = [...IMAGE_EXTS, 'image/*'].join(',');
const MIN_FILES = 3;
const MAX_FILES = 10;

const extOf = (name: string) => {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
};

const looksLikeImage = (f: File) => (f.type || '').startsWith('image/') || IMAGE_EXTS.includes(extOf(f.name));

const STATUS: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'gold', label: '待审核' },
  APPROVED: { color: 'green', label: '已采纳' },
  REJECTED: { color: 'red', label: '已驳回' },
};

const BattleScreenshotsPage: React.FC = () => {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [items, setItems] = useState<BattleScreenshot[]>([]);
  const [loading, setLoading] = useState(false);
  const user = useAuthStore((s) => s.user);
  const [currentStatus, setCurrentStatus] = useState('AVAILABLE');
  const [pendingCount, setPendingCount] = useState(0);
  const pendingRef = useRef<Array<{ files: File[]; customerId?: string }>>([]);
  // antd 会把 accept 匹配不上的拖拽文件静默丢掉，这里自己记一笔账：
  // 拖进来的数量 ≠ 真正进列表的数量时，明确告诉陪玩「有几个没识别、该怎么办」。
  const fileListRef = useRef<UploadFile[]>([]);
  const dropProbeRef = useRef(0);

  useEffect(() => {
    fileListRef.current = fileList;
  }, [fileList]);

  // 真正要上传的文件：antd 的 fileList 里存的是包装对象，原始 File 在 originFileObj。
  const files = useMemo(
    () => fileList.map((f) => (f.originFileObj as File) ?? (f as unknown as File)),
    [fileList],
  );

  // 不在这里上传，等点「提交审核」时统一提交（空闲立即传 / 服务中先暂存 的逻辑不变）。
  const beforeUpload = (file: File) => {
    if (!looksLikeImage(file)) {
      message.error(`「${file.name || '这个文件'}」看起来不是图片，请用 JPG / PNG / WebP 等格式`);
      return Upload.LIST_IGNORE;
    }
    return false;
  };

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await battleScreenshotsApi.mine();
      setItems(data?.data ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
    customersApi
      .list()
      .then(({ data }: any) => setCustomers(data?.data ?? []))
      .catch(() => {});
  }, [fetchItems]);

  const doUpload = useCallback(async (list: File[], cid?: string) => {
    try {
      await battleScreenshotsApi.upload(list, cid);
      message.success('已提交，等待管理端审核');
      fetchItems();
      return true;
    } catch (e: any) {
      message.error(e?.response?.data?.message || '上传失败');
      return false;
    }
  }, [fetchItems]);

  // 每隔一段时间检查陪玩状态：空闲时才真正上传到服务器；服务中先暂存。
  useEffect(() => {
    const check = async () => {
      try {
        const { data } = await companionsApi.getById(user?.companionId ?? '');
        const st = data?.data?.status ?? 'AVAILABLE';
        setCurrentStatus(st);
        if (st === 'AVAILABLE' && pendingRef.current.length > 0) {
          const item = pendingRef.current.shift();
          setPendingCount(pendingRef.current.length);
          if (item) await doUpload(item.files, item.customerId);
        }
      } catch {
        /* ignore */
      }
    };
    check();
    const t = visibleInterval(check, 30000);
    return () => clearInterval(t);
  }, [user?.companionId, doUpload]);

  const submit = async () => {
    if (files.length < MIN_FILES) {
      message.warning(`最少上传 ${MIN_FILES} 张战绩图为一组（现在 ${files.length} 张）`);
      return;
    }
    setFileList([]);
    setCustomerId(undefined);
    if (currentStatus === 'AVAILABLE') {
      setSubmitting(true);
      await doUpload(files, customerId);
      setSubmitting(false);
    } else {
      pendingRef.current.push({ files, customerId });
      setPendingCount(pendingRef.current.length);
      message.info('服务中暂缓上传，已暂存，空闲后会自动上传');
    }
  };

  return (
    <div>
      <PageHeader title="🏆 战绩图上传" subtitle="上传你的高光战绩图，审核采纳后可为综合评分加分（作为小红书素材）" />
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Space>
            <Text strong>关联客户（可选）：</Text>
            <Select
              placeholder="选择同一客户ID（可选）"
              allowClear
              style={{ width: 280 }}
              value={customerId}
              onChange={setCustomerId}
              options={customers.map((c: any) => ({
                value: c.id,
                label: c.customerCode ? `${c.customerCode} · ${c.wechatId || ''}` : c.wechatId || c.id,
              }))}
            />
          </Space>
          <div
            onDropCapture={(e) => {
              const dropped = e.dataTransfer?.files?.length ?? 0;
              if (!dropped) return;
              const before = fileListRef.current.length;
              dropProbeRef.current = dropped;
              window.setTimeout(() => {
                const added = fileListRef.current.length - before;
                if (added < dropProbeRef.current) {
                  message.warning(
                    `拖进来 ${dropProbeRef.current} 个文件，只认出 ${Math.max(0, added)} 个。` +
                      '微信拖出来的临时文件有时不是图片格式：先在微信里「另存为」成图片再拖，或点上面的框直接选文件。',
                  );
                }
              }, 300);
            }}
          >
            <Dragger
              multiple
              maxCount={MAX_FILES}
              accept={IMAGE_ACCEPT}
              fileList={fileList}
              beforeUpload={beforeUpload}
              onChange={(info) => setFileList(info.fileList)}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">点击或拖拽上传战绩图</p>
              <p className="ant-upload-hint">
                必须同一个陪玩ID或同一个客户ID，最少 {MIN_FILES} 张为一组（最多 {MAX_FILES} 张）
              </p>
            </Dragger>
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            支持 JPG / PNG / WebP / GIF / BMP；微信电脑端里的图可以直接拖进来，拖不动就先「另存为」成图片再拖。
          </Text>
          <Button type="primary" loading={submitting} onClick={submit} disabled={files.length < MIN_FILES}>
            {files.length < MIN_FILES
              ? `提交审核（已有 ${files.length} 张，还差 ${MIN_FILES - files.length} 张）`
              : `提交审核（${files.length} 张）`}
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            当前状态：{currentStatus === 'AVAILABLE' ? '空闲' : '服务中'}
            {pendingCount > 0 ? `，已暂存 ${pendingCount} 组，空闲后自动上传` : '，提交后立即上传'}
          </Text>
        </Space>
      </Card>

      <Card size="small" title="我的提交记录">
        {loading ? (
          <Spin />
        ) : items.length === 0 ? (
          <Empty description="还没有上传过战绩图" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map((it) => (
              <div key={it.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', borderBottom: '1px solid #f0f0f0', paddingBottom: 12 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                  {it.images.map((url, i) => (
                    <Image key={i} src={url} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 6 }} />
                  ))}
                </div>
                <Space direction="vertical" size={4}>
                  <Tag color={STATUS[it.status]?.color}>{STATUS[it.status]?.label}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>{new Date(it.createdAt).toLocaleString('zh-CN')}</Text>
                  {it.note && <Text type="secondary" style={{ fontSize: 12 }}>备注：{it.note}</Text>}
                </Space>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default BattleScreenshotsPage;
