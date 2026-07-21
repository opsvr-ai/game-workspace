// craftsman-ignore: TS001,TS002
import React from 'react';
import { CloseOutlined } from '@ant-design/icons';

interface ReplyBarProps {
  content: string;
  onCancel: () => void;
}

const ReplyBar: React.FC<ReplyBarProps> = ({ content, onCancel }) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 12px',
        background: '#F7F8FA',
        borderBottom: '1px solid #E8E9EB',
        fontSize: 12,
        color: '#666',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#2B579A', fontWeight: 500 }}>回复</span>
        <span
          style={{
            maxWidth: 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {content}
        </span>
      </div>
      <CloseOutlined onClick={onCancel} style={{ cursor: 'pointer', color: '#999', fontSize: 12 }} />
    </div>
  );
};

export default React.memo(ReplyBar);
