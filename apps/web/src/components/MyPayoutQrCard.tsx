// craftsman-ignore: TS001,TS002,TS003
import React, { useCallback, useEffect, useState } from 'react';
import { Card, Button, Space, Typography, Upload, Tag } from 'antd';
import { message } from '../utils/feedback';
import { UploadOutlined } from '@ant-design/icons';
import { companionsApi } from '../api/companions';
import http from '../api/client';
import PasteImageBox from './PasteImageBox';
import PayoutQrScan from './PayoutQrScan';

const { Text } = Typography;

const fmtDay = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * 「我的报账微信码」（老板 2026-09-29：「每个陪玩在报账那里给他留个位置，让陪玩自己上传
 * 自己的报账微信码，每次报账点开这个码，拿手机扫一扫就可以了」）。
 *
 * 陪玩自己传一次（可以从文件夹选，也可以直接 Ctrl+V 粘微信收款码截图），
 * 传一次以后财务在「陪玩审核 + 支取」「报账与支取统计」里点开就能扫，不用每次在群里要图。
 */
const MyPayoutQrCard: React.FC = () => {
  const [url, setUrl] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await companionsApi.payoutQr();
      const d = (data as any)?.data || {};
      setUrl(d.payoutQrUrl || null);
      setUpdatedAt(d.payoutQrUpdatedAt || null);
    } catch {
      /* 拉不到就当没传过，不影响报账 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    setSaving(true);
    try {
      const { data } = await http.post('/upload/screenshot', fd);
      const uploaded = (data as any)?.data?.url || (data as any)?.url || '';
      if (!uploaded) throw new Error('no url');
      await companionsApi.setPayoutQr(uploaded);
      message.success(url ? '报账微信码已换新' : '报账微信码已保存');
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '上传失败，换张图再试');
    } finally {
      setSaving(false);
    }
    return false;
  };

  return (
    <Card size="small" style={{ marginBottom: 12 }} loading={loading}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center' }}>
          {url ? (
            <img
              src={url}
              alt="我的报账微信码"
              style={{ width: 132, height: 132, objectFit: 'contain', border: '1px solid #E5E7EB', borderRadius: 10, background: '#fff' }}
            />
          ) : (
            <div
              style={{
                width: 132,
                height: 132,
                border: '1px dashed #D0D5DD',
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#98A2B3',
                fontSize: 12,
                textAlign: 'center',
                padding: 8,
                boxSizing: 'border-box',
              }}
            >
              还没传收款码
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 280 }}>
          <Space size={8} wrap>
            <Text strong>我的报账微信码</Text>
            {url ? <Tag color="green">已上传</Tag> : <Tag color="orange">还没上传</Tag>}
            {url && updatedAt && (
              <Text type="secondary" style={{ fontSize: 12 }}>上次更换：{fmtDay(updatedAt)}</Text>
            )}
          </Space>
          <div style={{ marginTop: 6 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              传一次就行：财务报账、发工资的时候点开这个码，拿手机扫一扫就把钱转给你，不用每次在群里发图。
              换微信号 / 换收款码了，回来重新传一张覆盖掉。
            </Text>
          </div>
          <div style={{ marginTop: 10 }}>
            <Space size={8} wrap>
              {url && (
                <PayoutQrScan url={url} who="我" variant="default" label="点开大图（手机扫）" updatedAt={updatedAt} />
              )}
              <PasteImageBox onFile={upload}>
                <Upload showUploadList={false} accept="image/*" beforeUpload={upload}>
                  <Button icon={<UploadOutlined />} loading={saving} type={url ? 'default' : 'primary'}>
                    {url ? '换一张' : '上传我的收款码'}
                  </Button>
                </Upload>
              </PasteImageBox>
            </Space>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default MyPayoutQrCard;
