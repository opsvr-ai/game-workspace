// craftsman-ignore: TS001
import React from 'react';
import { Modal, Button, Space, Typography } from 'antd';
import { PhoneOutlined, CloseOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

interface Props {
  open: boolean;
  callerName?: string;
  onAccept: () => void;
  onReject: () => void;
}

const IncomingCallModal: React.FC<Props> = ({ open, callerName, onAccept, onReject }) => {
  return (
    <Modal open={open} closable={false} footer={null} width={320} centered>
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ fontSize: 48, animation: 'pulse 1s infinite', marginBottom: 16 }}>📞</div>
        <Title level={4} style={{ marginBottom: 4 }}>{callerName || '未知'}</Title>
        <Text type="secondary">邀请你进行语音通话</Text>
        <div style={{ marginTop: 24 }}>
          <Space size={24}>
            <Button type="primary" size="large" shape="circle" icon={<PhoneOutlined />} onClick={onAccept} style={{ background: '#52c41a', borderColor: '#52c41a' }} />
            <Button danger size="large" shape="circle" icon={<CloseOutlined />} onClick={onReject} />
          </Space>
        </div>
      </div>
    </Modal>
  );
};

export default IncomingCallModal;
