// craftsman-ignore: TS001,TS002,TS003
import React, { useState } from 'react';
import { Button, Modal, Typography, Space } from 'antd';
import EmptyState from './EmptyState';
import { QrcodeOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface Props {
  /** 收款码图片地址；没传过就是空 */
  url?: string | null;
  /** 谁的码（「童祥瑞 的报账微信码」） */
  who?: string;
  /** 按钮样式：link（表格里）/ default（卡片里） */
  variant?: 'link' | 'default';
  /** 按钮文字，默认「收款码」 */
  label?: string;
  /** 最后一次更换时间（可选，弹窗里提示一下） */
  updatedAt?: string | null;
}

const fmtDay = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * 「点开这个码，拿手机扫一扫」（老板 2026-09-29）：
 * 财务在报账 / 支取 / 发工资的列表里点一下，直接弹出一张大图 —— 拿手机微信扫就走人，
 * 不用再去群里翻陪玩发过的截图。
 */
const PayoutQrScan: React.FC<Props> = ({ url, who, variant = 'link', label = '收款码', updatedAt }) => {
  const [open, setOpen] = useState(false);
  const hasQr = !!url;

  return (
    <>
      <Button
        type={variant === 'link' ? 'link' : 'default'}
        size="small"
        icon={<QrcodeOutlined />}
        disabled={!hasQr}
        title={hasQr ? '点开扫码转账' : '这个陪玩还没上传报账微信码'}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setOpen(false)}>关闭</Button>
          </Space>
        }
        width={460}
        centered
        destroyOnClose
        title={`${who ? who + ' ' : ''}报账微信码`}
      >
        {url ? (
          <div style={{ textAlign: 'center' }}>
            <img
              src={url}
              alt="报账微信码"
              style={{
                width: 360,
                height: 360,
                objectFit: 'contain',
                border: '1px solid #E5E7EB',
                borderRadius: 12,
                background: '#fff',
              }}
            />
            <div style={{ marginTop: 10 }}>
              <Text type="secondary">打开手机微信 → 扫一扫，用这个码转账</Text>
            </div>
            {updatedAt && (
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  陪玩最后一次更换：{fmtDay(updatedAt)}
                </Text>
              </div>
            )}
          </div>
        ) : (
          <EmptyState description="这个陪玩还没上传报账微信码（陪玩端 → 报账系统 → 我的报账微信码）" />
        )}
      </Modal>
    </>
  );
};

export default PayoutQrScan;
