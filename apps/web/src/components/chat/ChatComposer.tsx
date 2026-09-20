// craftsman-ignore: TS001,TS002
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button, Input, message } from 'antd';
import { SendOutlined, SmileOutlined, PaperClipOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import http from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import ReplyBar from './ReplyBar';

interface ChatComposerProps {
  onSend: (text: string, replyToId?: string, mentionUserIds?: string[]) => void;
  onUpload?: (file: File) => Promise<string | undefined>;
  uploading?: boolean;
  groupMembers?: Array<{ userId: string; username: string; displayName?: string; role: string }>;
  mentionRequest?: { nonce: number; name: string } | null;
}

const EMOJI_CATEGORIES: Record<string, string[]> = {
  '😊 表情': ['😀','😃','😄','😁','😅','😂','🤣','😊','😇','🙂','😉','😌','😍','🥰','😘','😗','😋','🤪','😜','😝','😎','🤓','🧐','😏','😒','😞','😔','😟','😕','🙁','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','😈','👿','💀','☠️'],
  '👍 手势': ['👍','👎','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤙','💪','🦾','🖕','✍️','🙏','🦶','🦵','💄','💋','👄','🦷','👅','👂','🦻','👃','👣','👀','👁️','🧠','🫀','🫁'],
  '🎉 活动': ['🎉','🎊','🎈','🎂','🎀','🎁','🏆','🥇','🥈','🥉','🎖️','🏅','🎗️','🎟️','🎫','🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎹','🎸','🎺','🎷','🥁','🎯','🎳','🎮','🎲','🎰','🧩','♟️','🎯'],
  '❤️ 符号': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🛗','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','⚧','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','#️⃣','*️⃣','⏏️','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','⏫','⏬','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↪️','↩️','⤴️','⤵️','🔀','🔁','🔂','🔄','🔃','🎵','🎶','➕','➖','➗','✖️','♾️','💲','💱','™️','©️','®️','〰️','➰','➿','🔚','🔙','🔛','🔝','🔜','✔️','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫'],
  '🍔 食物': ['🍔','🍟','🍕','🌭','🍿','🧂','🥓','🥚','🧇','🥞','🧈','🍞','🥐','🥨','🥯','🥖','🫓','🧀','🥗','🥙','🥪','🌮','🌯','🫔','🥫','🍖','🍗','🥩','🍠','🥟','🥠','🥡','🍱','🍘','🍙','🍚','🍛','🍜','🍝','🍲','🍢','🍣','🍤','🍥','🥮','🍡','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🍎','🍏','🍐','🍑','🍒','🍓','🫐','🥝','🍅','🫒','🥥','🥑','🍆','🥔','🥕','🌽','🌶️','🫑','🥒','🥬','🥦','🧄','🧅','🍄','🥜','🫘','🌰','🍞','🥐','🥖','🫓','🧀','🍖','🍗','🥩','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🫔','🥙','🧆','🥚','🍳','🥘','🍲','🫕','🥣','🥗','🍿','🧈','🧂','🥫','🍝','🍜','🍛','🍚','🍱','🍣','🍤','🍥','🥮','🍡','🥟','🥠','🥡','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🍼','🥛','☕','🫖','🍵','🍶','🍺','🍻','🥂','🍷','🫗','🥃','🍸','🍹','🧉','🍾','🧊','🥄','🍴','🍽️','🥣','🥡','🥢','🧂'],
  '🎮 游戏': ['🎮','🕹️','🎲','🎯','🎳','🎰','♠️','♥️','♦️','♣️','🃏','🀄','🎴','🎱','🎾','🏓','🏸','🏒','🏑','🥍','🏏','🎿','⛷️','🏂','🪂','🏋️','🤼','🤸','🤺','⛹️','🤾','🏌️','🏇','🧘','🏄','🏊','🤽','🧜','🧚','🧞','🧝','🧙','🧛','🦸','🦹','🤶','🎅','🧑‍🎄','💂','🕵️','👮','👷','🦺','👩‍🌾','👩‍🍳','👩‍🎓','👩‍🎤','👩‍🏫','👩‍🏭','👩‍💻','👩‍💼','👩‍🔧','👩‍🔬','👩‍🎨','👩‍🚒','👩‍✈️','👩‍🚀','👩‍⚖️'],
};

// Load custom emojis from localStorage + sync with server
function loadCustomEmojis(): string[] {
  try {
    return JSON.parse(localStorage.getItem('custom-emojis') || '[]');
  } catch { return []; }
}
function saveCustomEmojis(emojis: string[]) {
  localStorage.setItem('custom-emojis', JSON.stringify(emojis));
  http.put('/auth/me/emojis', { emojis }).catch(() => {});
}

const ChatComposer: React.FC<ChatComposerProps> = ({ onSend, onUpload, uploading, groupMembers = [], mentionRequest }) => {
  const userId = useAuthStore((s) => s.user?.id || 'anonymous');
  const inputHeightStorageKey = `chat-input-height:${userId}`;
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; content: string } | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(0);
  const [activeTab, setActiveTab] = useState('😊 表情');
  const [customEmojis, setCustomEmojis] = useState<string[]>(loadCustomEmojis);
  const [addEmojiInput, setAddEmojiInput] = useState('');
  const [inputHeight, setInputHeight] = useState<number>(() => {
    try {
      const saved = parseInt(localStorage.getItem(inputHeightStorageKey) || '', 10);
      return Number.isFinite(saved) && saved >= 36 ? saved : 36;
    } catch {
      return 36;
    }
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiButtonRef = useRef<HTMLSpanElement>(null);
  const emojiPanelRef = useRef<HTMLDivElement>(null);
  const mentionPanelRef = useRef<HTMLDivElement>(null);

  // 群聊里右键发送者名字时，把 @名字 插入到输入框当前光标处。
  useEffect(() => {
    if (!mentionRequest) return;
    const el = textareaRef.current;
    const start = el?.selectionStart ?? 0;
    const end = el?.selectionEnd ?? 0;
    const insertText = `@${mentionRequest.name} `;
    setText((prev) => {
      const next = prev.slice(0, start) + insertText + prev.slice(end);
      requestAnimationFrame(() => {
        if (el) {
          el.focus();
          const pos = start + insertText.length;
          el.setSelectionRange(pos, pos);
        }
      });
      return next;
    });
  }, [mentionRequest?.nonce, mentionRequest?.name]);

  const persistInputHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const height = Math.max(36, el.offsetHeight);
    setInputHeight(height);
    localStorage.setItem(inputHeightStorageKey, String(height));
  }, [inputHeightStorageKey]);

  // 用 ResizeObserver 可靠地捕捉用户拖拽调整的高度（原生 resize 不触发 React onMouseUp）
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    let last = el.offsetHeight;
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (h !== last) {
        last = h;
        const height = Math.max(36, h);
        setInputHeight(height);
        localStorage.setItem(inputHeightStorageKey, String(height));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [inputHeightStorageKey]);

  // 微信式交互：点击面板外或按 Esc 关闭表情面板
  useEffect(() => {
    if (!showEmoji) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (emojiPanelRef.current?.contains(target) || emojiButtonRef.current?.contains(target)) return;
      setShowEmoji(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowEmoji(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showEmoji]);

  useEffect(() => {
    if (!mentionOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (mentionPanelRef.current?.contains(target)) return;
      setMentionOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMentionOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [mentionOpen]);

  const insertEmoji = useCallback((emoji: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const value = /^https?:\/\//i.test(emoji) || emoji.startsWith('/uploads/')
      ? `[img]${emoji}[/img]`
      : emoji;
    setText((prev) => {
      const next = prev.slice(0, start) + value + prev.slice(end);
      requestAnimationFrame(() => {
        if (el) {
          el.focus();
          const pos = start + value.length;
          el.setSelectionRange(pos, pos);
        }
      });
      return next;
    });
    setShowEmoji(false);
  }, [text]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const names = Array.from(trimmed.matchAll(/@([^\s@]+)/g)).map((m) => m[1]);
    const mentionUserIds = Array.from(
      new Set(
        groupMembers
          .filter(
            (m) =>
              names.includes(m.displayName || m.username) ||
              names.includes(m.username),
          )
          .map((m) => m.userId),
      ),
    );
    onSend(trimmed, replyTo?.id, mentionUserIds);
    setText('');
    setReplyTo(null);
    setShowEmoji(false);
    setMentionOpen(false);
  }, [text, replyTo, onSend, groupMembers]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const caret = e.target.selectionStart || 0;
    setText(value);
    const before = value.slice(0, caret);
    const match = before.match(/@([^\s@]*)$/);
    if (match && groupMembers.length > 0) {
      setMentionQuery(match[1].toLowerCase());
      setMentionStart(caret - match[0].length);
      setMentionOpen(true);
    } else {
      setMentionOpen(false);
    }
  }, [groupMembers]);

  const selectMention = (member: { userId: string; username: string; displayName?: string }) => {
    const name = member.displayName || member.username;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, mentionStart) + `@${name} `;
    const after = text.slice(caret);
    setText(before + after);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        const pos = mentionStart + name.length + 2;
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUpload) return;
    const marker = await onUpload(file);
    if (marker) setText((prev) => prev + (prev ? ' ' : '') + marker);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const addCustomEmoji = () => {
    const trimmed = addEmojiInput.trim();
    if (!trimmed) return;
    const updated = [...customEmojis, trimmed];
    setCustomEmojis(updated);
    saveCustomEmojis(updated);
    setAddEmojiInput('');
    message.success('表情已收藏');
  };

  const removeCustomEmoji = (emoji: string) => {
    const updated = customEmojis.filter((e) => e !== emoji);
    setCustomEmojis(updated);
    saveCustomEmojis(updated);
  };

  const tabs = [...Object.keys(EMOJI_CATEGORIES), '⭐ 收藏'];

  return (
    <div style={{ flexShrink: 0, borderTop: '1px solid #E8E9EB', background: '#FFF' }}>
      {replyTo && <ReplyBar content={replyTo.content} onCancel={() => setReplyTo(null)} />}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '8px 12px' }}>
        <div style={{ display: 'flex', gap: 2, paddingBottom: 4 }}>
          <span
            ref={emojiButtonRef}
            onClick={() => { setShowEmoji(!showEmoji); textareaRef.current?.focus(); }}
            style={{ cursor: 'pointer', padding: 4, color: showEmoji ? '#2B579A' : '#949BA4' }}
          >
            <SmileOutlined style={{ fontSize: 20 }} />
          </span>
          {onUpload && (
            <>
              <span onClick={() => { fileInputRef.current?.click(); textareaRef.current?.focus(); }}
                style={{ cursor: 'pointer', padding: 4, color: '#949BA4' }}>
                <PaperClipOutlined style={{ fontSize: 20 }} />
              </span>
              <input ref={fileInputRef} type="file" hidden onChange={handleUpload}
                accept="image/*,.pdf,.zip,.mp3,.wav" />
            </>
          )}
        </div>

        <textarea ref={textareaRef} value={text} onChange={handleChange}
          onKeyDown={handleKeyDown} onMouseUp={persistInputHeight} onBlur={persistInputHeight}
          onPaste={async (e) => {
            const items = e.clipboardData?.items;
            if (!items || !onUpload) return;
            for (let i = 0; i < items.length; i++) {
              if (items[i].type.startsWith('image/')) {
                e.preventDefault();
                const file = items[i].getAsFile();
                if (file) {
                  const markup = await onUpload(file);
                  if (markup) setText((prev) => prev + '\n' + markup + '\n');
                  message.success('图片已粘贴');
                }
                break;
              }
            }
          }} placeholder="输入消息..." rows={1}
          style={{
            flex: 1, height: inputHeight, border: 'none', outline: 'none', resize: 'vertical',
            fontSize: 14, lineHeight: '22px', padding: '6px 8px', background: '#F5F6FA',
            borderRadius: 6, fontFamily: 'inherit', minHeight: 36, maxHeight: 200,
          }}
        />

        <Button type="primary" icon={<SendOutlined />} onClick={handleSend} loading={uploading}
          disabled={!text.trim()}
          style={{ borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
        />
      </div>

      {mentionOpen && groupMembers.length > 0 && (
        <div
          ref={mentionPanelRef}
          style={{
            maxHeight: 180,
            overflowY: 'auto',
            borderTop: '1px solid #F0F0F0',
            background: '#FFF',
            padding: 4,
          }}
        >
          {groupMembers
            .filter((m) => {
              const name = `${m.displayName || ''}${m.username}`.toLowerCase();
              return !mentionQuery || name.includes(mentionQuery);
            })
            .slice(0, 20)
            .map((m) => (
              <div
                key={m.userId}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  selectMention(m);
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                {m.displayName || m.username}
              </div>
            ))}
        </div>
      )}

      {/* Emoji picker panel */}
      {showEmoji && (
        <div ref={emojiPanelRef} style={{ borderTop: '1px solid #F0F0F0', maxHeight: 280, display: 'flex', flexDirection: 'column' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 0, padding: '4px 8px', borderBottom: '1px solid #F0F0F0', overflowX: 'auto' }}>
            {tabs.map((tab) => (
              <span key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  cursor: 'pointer', padding: '4px 10px', borderRadius: 6, fontSize: 12,
                  whiteSpace: 'nowrap', flexShrink: 0,
                  background: activeTab === tab ? '#E8F0FE' : 'transparent',
                  color: activeTab === tab ? '#2B579A' : '#666',
                  fontWeight: activeTab === tab ? 600 : 400,
                }}
              >{tab}</span>
            ))}
          </div>

          {/* Emoji grid */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
            {activeTab === '⭐ 收藏' ? (
              <div>
                {/* Add custom emoji */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <Input size="small" placeholder="输入emoji或URL..."
                    value={addEmojiInput} onChange={(e) => setAddEmojiInput(e.target.value)}
                    onPressEnter={addCustomEmoji}
                    style={{ flex: 1 }}
                  />
                  <Button size="small" icon={<PlusOutlined />} onClick={addCustomEmoji}>收藏</Button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {customEmojis.length === 0 && (
                    <span style={{ color: '#999', fontSize: 12 }}>暂无收藏表情，输入 emoji 字符或图片 URL 添加</span>
                  )}
                  {customEmojis.map((emoji, i) => (
                    <span key={i} style={{ position: 'relative', display: 'inline-block' }}>
                      <span onClick={() => insertEmoji(emoji)}
                        style={{ cursor: 'pointer', fontSize: 28, padding: 4, borderRadius: 6, display: 'inline-block', transition: 'background 0.1s' }}
                        onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#F0F0F0'; }}
                        onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                      >
                        {/^https?:\/\//i.test(emoji) || emoji.startsWith('/uploads/') ? (
                          <img src={emoji} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                        ) : (
                          emoji
                        )}
                      </span>
                      <DeleteOutlined
                        onClick={() => removeCustomEmoji(emoji)}
                        style={{ position: 'absolute', top: -2, right: -2, fontSize: 10, color: '#F23F42', cursor: 'pointer', background: '#FFF', borderRadius: '50%', padding: 1 }}
                      />
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                {(EMOJI_CATEGORIES[activeTab] || []).map((emoji) => (
                  <span key={emoji}
                    onClick={() => insertEmoji(emoji)}
                    style={{ cursor: 'pointer', fontSize: 24, padding: 4, borderRadius: 6, transition: 'background 0.1s', lineHeight: 1.2 }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#F0F0F0'; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                  >{emoji}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(ChatComposer);
