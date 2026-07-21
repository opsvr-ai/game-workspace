// craftsman-ignore: TS001,TS002
import React from 'react';
import type { Message } from '../../stores/chatStore';

interface ReplyPreviewProps {
  replyTo: NonNullable<Message['replyTo']>;
  onClick?: () => void;
}

const ReplyPreview: React.FC<ReplyPreviewProps> = ({ replyTo, onClick }) => {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        gap: 8,
        marginBottom: 4,
        padding: '6px 10px',
        background: 'rgba(43, 87, 154, 0.06)',
        borderRadius: 8,
        borderLeft: '3px solid #2B579A',
        cursor: onClick ? 'pointer' : 'default',
        fontSize: 12,
        color: '#666',
        maxWidth: '80%',
      }}
    >
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {replyTo.content || '[消息]'}
      </span>
    </div>
  );
};

export default React.memo(ReplyPreview);
