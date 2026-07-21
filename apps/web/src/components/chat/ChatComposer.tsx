// craftsman-ignore: TS001,TS002
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from 'antd';
import { SendOutlined, SmileOutlined, PaperClipOutlined } from '@ant-design/icons';
import ReplyBar from './ReplyBar';

interface ChatComposerProps {
  onSend: (text: string, replyToId?: string) => void;
  onUpload?: (file: File) => Promise<string | undefined>;
  uploading?: boolean;
}

const ChatComposer: React.FC<ChatComposerProps> = ({ onSend, onUpload, uploading }) => {
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; content: string } | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const QUICK_EMOJIS = ['😀', '😂', '👍', '❤️', '🔥', '😢', '😮', '🎉', '💪', '🙏', '👌', '🤝'];

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }
  }, [text]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, replyTo?.id);
    setText('');
    setReplyTo(null);
  }, [text, replyTo, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Enter to send, Shift+Enter for newline
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUpload) return;
    const marker = await onUpload(file);
    if (marker) setText((prev) => prev + (prev ? ' ' : '') + marker);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div style={{ flexShrink: 0, borderTop: '1px solid #E8E9EB', background: '#FFF' }}>
      {/* Reply bar */}
      {replyTo && <ReplyBar content={replyTo.content} onCancel={() => setReplyTo(null)} />}

      {/* Input area */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          padding: '8px 12px',
        }}
      >
        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 2, paddingBottom: 4 }}>
          <span
            onClick={() => setShowEmoji(!showEmoji)}
            style={{ cursor: 'pointer', padding: 4, color: showEmoji ? '#2B579A' : '#949BA4' }}
          >
            <SmileOutlined style={{ fontSize: 20 }} />
          </span>
          {onUpload && (
            <>
              <span
                onClick={() => fileInputRef.current?.click()}
                style={{ cursor: 'pointer', padding: 4, color: '#949BA4' }}
              >
                <PaperClipOutlined style={{ fontSize: 20 }} />
              </span>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                onChange={handleUpload}
                accept="image/*,.pdf,.zip,.mp3,.wav"
              />
            </>
          )}
        </div>

        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          rows={1}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            resize: 'none',
            fontSize: 14,
            lineHeight: '22px',
            padding: '6px 0',
            background: 'transparent',
            fontFamily: 'inherit',
            maxHeight: 120,
          }}
        />

        {/* Send button */}
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={uploading}
          disabled={!text.trim()}
          style={{
            borderRadius: '50%',
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        />
      </div>

      {/* Emoji picker */}
      {showEmoji && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
            padding: '8px 12px',
            borderTop: '1px solid #F0F0F0',
            maxHeight: 120,
            overflowY: 'auto',
          }}
        >
          {QUICK_EMOJIS.map((emoji) => (
            <span
              key={emoji}
              onClick={() => {
                setText((prev) => prev + emoji);
                setShowEmoji(false);
              }}
              style={{ cursor: 'pointer', fontSize: 22, padding: 4, borderRadius: 6, transition: 'background 0.1s' }}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.background = '#F0F0F0';
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.background = 'transparent';
              }}
            >
              {emoji}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default React.memo(ChatComposer);
