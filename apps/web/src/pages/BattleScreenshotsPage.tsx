// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Upload, Select, Typography, Space, Tag, message, Image, Empty, Spin } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { battleScreenshotsApi, type BattleScreenshot } from '../api/battleScreenshots';
import { customersApi } from '../api/customers';
import PageHeader from '../components/PageHeader';

const { Text } = Typography;
const { Dragger } = Upload;

const STATUS: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'gold', label: '待审核' },
  APPROVED: { color: 'green', label: '已采纳' },
  REJECTED: { color: 'red', label: '已驳回' },
};

const BattleScreenshotsPage: React.FC = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [items, setItems] = useState<BattleScreenshot[]>([]);
  const [loading, setLoading] = useState(false);

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

  const submit = async () => {
    if (files.length < 3) {
      message.warning('最少上传 3 张战绩图为一组');
      return;
    }
    setSubmitting(true);
    try {
      await battleScreenshotsApi.upload(files, customerId);
      message.success('已提交，等待管理端审核');
      setFiles([]);
      setCustomerId(undefined);
      fetchItems();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '上传失败');
    } finally {
      setSubmitting(false);
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
          <Dragger
            multiple
            accept="image/*"
            fileList={files.map((f: any, i) => ({ uid: String(i), name: f.name, status: 'done' }))}
            beforeUpload={() => false}
            onChange={(info) => setFiles(info.fileList.map((f: any) => f.originFileObj).filter(Boolean))}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">点击或拖拽上传战绩图</p>
            <p className="ant-upload-hint">必须同一个陪玩ID或同一个客户ID，最少 3 张为一组</p>
          </Dragger>
          <Button type="primary" loading={submitting} onClick={submit} disabled={files.length < 3}>
            提交审核（{files.length} 张）
          </Button>
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
