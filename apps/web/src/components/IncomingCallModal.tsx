// craftsman-ignore: TS001
import React from 'react';
import { Modal, Button, Space, Typography } from 'antd';
import { PhoneOutlined, CloseOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

interface Props {
  open: boolean;
  callerName?: string;
  calling?: boolean;
  onAccept: () => void;
  onReject: () => void;
}

const IncomingCallModal: React.FC<Props> = ({ open, callerName, calling, onAccept, onReject }) => {
  return (
    <Modal open={open} closable={false} footer={null} width="100vw" centered style={{ top: 0, maxWidth: '100%' }} bodyStyle={{ padding: 0, height: '100vh' }}>
      <div style={{ textAlign: 'center', height: '100vh', paddingTop: '20vh', background: 'linear-gradient(180deg,#1E293B,#0F172A)', color: '#fff' }}>
        <div style={{ fontSize: 72, animation: 'pulse 1s infinite', marginBottom: 24 }}>📞</div>
        <Title level={3} style={{ marginBottom: 8, color: '#fff' }}>{callerName || '未知'}</Title>
        <Text style={{ color: 'rgba(255,255,255,0.7)' }}>{calling ? '正在呼叫...' : '邀请你进行语音通话'}</Text>
        <div style={{ marginTop: 48 }}>
          {calling ? (
            <Button danger size="large" shape="circle" icon={<CloseOutlined />} onClick={onReject} />
          ) : (
            <Space size={40}>
              <Button type="primary" size="large" shape="circle" icon={<PhoneOutlined />} onClick={onAccept} style={{ background: '#52c41a', borderColor: '#52c41a' }} />
              <Button danger size="large" shape="circle" icon={<CloseOutlined />} onClick={onReject} />
            </Space>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default IncomingCallModal;
