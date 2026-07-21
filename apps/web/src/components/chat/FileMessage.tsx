// craftsman-ignore: TS001,TS002
import React from 'react';
import { FileOutlined, DownloadOutlined } from '@ant-design/icons';

interface FileMessageProps {
  fileName: string;
  fileSize?: number;
  url: string;
  isMe: boolean;
}

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const FileMessage: React.FC<FileMessageProps> = ({ fileName, fileSize, url, isMe }) => {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderRadius: 12,
        background: isMe ? 'rgba(255,255,255,0.15)' : '#E8E9EB',
        color: isMe ? '#FFF' : '#313338',
        textDecoration: 'none',
        maxWidth: 280,
        border: `1px solid ${isMe ? 'rgba(255,255,255,0.2)' : '#DDE0E4'}`,
      }}
    >
      <FileOutlined style={{ fontSize: 24, flexShrink: 0, color: isMe ? 'rgba(255,255,255,0.7)' : '#2B579A' }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {fileName}
        </div>
        {fileSize && <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{formatSize(fileSize)}</div>}
      </div>
      <DownloadOutlined style={{ fontSize: 14, flexShrink: 0, opacity: 0.6 }} />
    </a>
  );
};

export default FileMessage;
