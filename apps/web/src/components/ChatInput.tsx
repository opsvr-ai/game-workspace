import React, { useState, useRef } from 'react';
import { Input, Button, message } from 'antd';
import { SendOutlined, SmileOutlined, PaperClipOutlined } from '@ant-design/icons';
import http from '../api/client';

interface Props {
  onSend: (text: string) => Promise<void>;
}

const QQ_EMOJIS = [
  '😀',
  '😂',
  '🤣',
  '😊',
  '😍',
  '🥰',
  '😘',
  '😜',
  '🤔',
  '😅',
  '😭',
  '🥺',
  '😤',
  '👍',
  '👎',
  '🙏',
  '💪',
  '🔥',
  '❤️',
  '💔',
  '⭐',
  '🎉',
  '💰',
  '✅',
  '❌',
  '⚠️',
  '🐶',
  '🐱',
  '🦊',
  '🐼',
  '🐸',
  '🐵',
  '🦁',
  '🐷',
  '🌹',
  '🌸',
  '🍎',
  '🍉',
  '🎮',
  '⚽',
  '🚗',
  '✈️',
  '⏰',
  '💡',
  '🔑',
  '🎵',
  '🌈',
  '☀️',
  '🌙',
  '⛄',
  '😎',
  '🤩',
  '😇',
  '😌',
];

const ChatInput: React.FC<Props> = ({ onSend }) => {
  const [input, setInput] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [customEmojis, setCustomEmojis] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('custom-emojis') || '[]');
    } catch {
      return [];
    }
  });
  const [_addEmojiUrl, _setAddEmojiUrl] = useState('');
  const inputRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const _syncEmojis = (next: string[]) => {
    setCustomEmojis(next);
    localStorage.setItem('custom-emojis', JSON.stringify(next));
    http.put('/auth/me/emojis', { emojis: next }).catch(() => {});
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await http.post('/companions/chat-upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const url = data?.data?.url;
      const name = data?.data?.name || file.name;
      if (url) {
        const isImage = file.type.startsWith('image/');
        const marker = isImage ? `[img]${url}[/img]` : `[file:${name}](${url})`;
        setInput((prev) => prev + (prev ? ' ' : '') + marker);
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || '上传失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setShowEmoji(false);
    await onSend(text);
  };

  return (
    <div style={{ background: '#FFF', borderTop: '1px solid #E8E8E8', flexShrink: 0 }}>
      {/* Quick bar */}
      <div style={{ display: 'flex', gap: 2, padding: '4px 12px' }}>
        {['👍', '❤️', '😊', '😂', '🎉', '🔥'].map((e) => (
          <span
            key={e}
            style={{ fontSize: 18, cursor: 'pointer', padding: '2px 6px', borderRadius: 4 }}
            onClick={() => {
              setInput((prev) => prev + e);
              inputRef.current?.focus();
            }}
          >
            {e}
          </span>
        ))}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleUpload}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
          style={{ display: 'none' }}
        />
        <span
          style={{
            fontSize: 16,
            cursor: uploading ? 'not-allowed' : 'pointer',
            padding: '2px 4px',
            opacity: uploading ? 0.5 : 1,
            color: '#666',
          }}
          onClick={() => !uploading && fileInputRef.current?.click()}
          title="上传图片或文件"
        >
          {React.createElement(PaperClipOutlined)}
        </span>
        <span
          style={{ fontSize: 16, cursor: 'pointer', padding: '2px 4px', color: showEmoji ? '#12B7F5' : '#666' }}
          onClick={() => setShowEmoji(!showEmoji)}
        >
          {React.createElement(SmileOutlined)}
        </span>
      </div>

      {/* Input + send */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '0 12px 10px' }}>
        <Input.TextArea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="输入消息..."
          autoSize={{ minRows: 1, maxRows: 4 }}
          style={{ flex: 1, borderRadius: 6, border: '1px solid #E0E0E0', resize: 'none', fontSize: 14 }}
        />
        <Button
          type="primary"
          onClick={send}
          disabled={!input.trim()}
          icon={React.createElement(SendOutlined)}
          style={{
            background: input.trim() ? '#07C160' : '#E0E0E0',
            borderColor: 'transparent',
            borderRadius: 6,
            fontWeight: 600,
          }}
        >
          发送
        </Button>
      </div>

      {/* Emoji panel */}
      {showEmoji && (
        <div
          style={{
            padding: '8px 12px',
            background: '#FFF',
            borderTop: '1px solid #F0F0F0',
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginBottom: 8 }}>
            {QQ_EMOJIS.map((e) => (
              <span
                key={e}
                style={{ fontSize: 20, cursor: 'pointer', padding: '3px 5px', borderRadius: 4 }}
                onClick={() => {
                  setInput((prev) => prev + e);
                  setShowEmoji(false);
                  inputRef.current?.focus();
                }}
              >
                {e}
              </span>
            ))}
          </div>
          {customEmojis.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingTop: 8, borderTop: '1px solid #F0F0F0' }}>
              {customEmojis.map((url: string, idx: number) => (
                <span
                  key={idx}
                  style={{ cursor: 'pointer', padding: 2, position: 'relative' }}
                  onClick={() => {
                    setInput((prev) => prev + ` [img]${url}[/img] `);
                    setShowEmoji(false);
                    inputRef.current?.focus();
                  }}
                >
                  <img src={url} style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 4 }} alt="" />
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export { ChatInput };
