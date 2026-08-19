import React, { useState, useEffect } from 'react';
import { Modal, Select, InputNumber, Button, message, Row, Col, Typography } from 'antd';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';

interface Props {
  open: boolean;
  onClose: () => void;
  customerId: string;
  companionId: string;
  onDone: () => void;
}

const StartServiceModal: React.FC<Props> = ({ open, onClose, customerId, companionId, onDone }) => {
  const [dual, setDual] = useState(false);
  const [amount, setAmount] = useState<number>(40);
  const [coAmount, setCoAmount] = useState<number>(40);
  const [coId, setCoId] = useState<string | undefined>();
  const [companions, setCompanions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) companionsApi.list().then((r: any) => setCompanions((r.data?.data || []).filter((c: any) => c.status === 'AVAILABLE'))).catch(() => {});
  }, [open]);

  const handleStart = async () => {
    if (!amount) return message.warning('请输入金额');
    setLoading(true);
    try {
      await ordersApi.create({
        type: 'NEW', dispatchType: 'DIRECT', companionId, coCompanionId: dual ? coId : undefined,
        amount, coAmount: dual ? coAmount : undefined, csUserId: 'self',
        customerId, gameName: '三角洲行动', serviceType: 'PLAY_WITH',
      });
      message.success('已开始服务');
      onClose(); onDone();
    } catch (e: any) { message.error(e?.response?.data?.message || '失败'); }
    setLoading(false);
  };

  const available = companions.filter((c: any) => c.id !== companionId);

  return (
    <Modal open={open} onCancel={onClose} title="开始服务" okText="开始" onOk={handleStart} confirmLoading={loading} width={360}>
      <Row gutter={12} align="middle" style={{ marginBottom: 12 }}>
        <Col span={8}><Typography.Text>模式</Typography.Text></Col>
        <Col span={16}>
          <Button size="small" type={!dual ? 'primary' : 'default'} onClick={() => setDual(false)} style={{ marginRight: 8 }}>单陪</Button>
          <Button size="small" type={dual ? 'primary' : 'default'} onClick={() => setDual(true)}>双陪</Button>
        </Col>
      </Row>
      <Row gutter={12} align="middle" style={{ marginBottom: 12 }}>
        <Col span={8}><Typography.Text>主陪</Typography.Text></Col>
        <Col span={16}><Typography.Text strong>自己</Typography.Text></Col>
      </Row>
      <Row gutter={12} align="middle" style={{ marginBottom: 12 }}>
        <Col span={8}><Typography.Text>我的金额</Typography.Text></Col>
        <Col span={16}><InputNumber min={0} value={amount} onChange={v => setAmount(v || 0)} prefix="¥" placeholder="？/人/h" style={{ width: '100%' }} /></Col>
      </Row>
      {dual && (
        <>
          <Row gutter={12} align="middle" style={{ marginBottom: 12 }}>
            <Col span={8}><Typography.Text>搭档</Typography.Text></Col>
            <Col span={16}>
              <Select value={coId} onChange={v => { setCoId(v); if (!v) setCoAmount(0); }} placeholder="选搭档" style={{ width: '100%' }} allowClear>
                {available.map((c: any) => <Select.Option key={c.id} value={c.id}>{c.user?.displayName || c.user?.username}</Select.Option>)}
              </Select>
            </Col>
          </Row>
          <Row gutter={12} align="middle" style={{ marginBottom: 12 }}>
            <Col span={8}><Typography.Text>搭档金额</Typography.Text></Col>
            <Col span={16}><InputNumber min={0} value={coAmount} onChange={v => setCoAmount(v || 0)} prefix="¥" placeholder="？/人/h" style={{ width: '100%' }} /></Col>
          </Row>
        </>
      )}
    </Modal>
  );
};

export default StartServiceModal;
