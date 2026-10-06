// craftsman-ignore: TS001,TS002
import React from 'react';
import { message } from '../utils/feedback';
import { getImagesFromClipboard, isImageFile } from '../utils/clipboardImage';
import { BRAND } from '../styles/tokens';

interface Props {
  /** 只收一张图时用（旧调用方，例如收款码 / 二维码）。 */
  onFile?: (file: File) => void;
  /** 一次收多张图时用（战绩图、聊天图片等）；传了就优先走这里。 */
  onFiles?: (files: File[]) => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  /** 默认 true：支持把图片直接拖进框里（可多张）。 */
  enableDrop?: boolean;
  /** 默认 true：显示底部「点一下 + Ctrl+V」提示。 */
  showHint?: boolean;
  /** 默认 false：去掉虚线框 / 灰底，用于包住 antd Dragger 等已有外观的控件。 */
  borderless?: boolean;
  hint?: React.ReactNode;
  disabled?: boolean;
}

type Entry = { el: HTMLElement; deliver: (files: File[]) => boolean };
const registry = new Set<Entry>();
let lastActive: Entry | null = null;

/** 判断粘贴目标是不是一个正在打字的输入框；是的话不抢它的粘贴。 */
const isTextEditable = (target: Node | null): boolean => {
  if (!target) return false;
  const el = target.nodeType === 1 ? (target as HTMLElement) : target.parentElement;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(type);
  }
  return false;
};

const onWindowPaste = (ev: ClipboardEvent) => {
  // 别抢已经被别人处理过的粘贴（例如表单自己已经识别了截图）。
  if (ev.defaultPrevented) return;
  const entries = Array.from(registry);
  if (!entries.length) return;
  const files = getImagesFromClipboard(ev);
  if (!files.length) return;

  const target = ev.target as Node | null;
  // 1）焦点落在某个粘贴框里：直接交给它。
  for (const entry of entries) {
    if (target && entry.el.contains(target) && entry.deliver(files)) {
      ev.preventDefault();
      return;
    }
  }
  // 2）焦点不在框里（例如刚打开弹窗、什么都没点）：
  //    不要抢输入框的粘贴；优先给「刚点过的那个框」，页面上只有一个框时也直接给它。
  if (isTextEditable(target)) return;
  const visible = entries.filter((en) => en.el.isConnected && en.el.getClientRects().length > 0);
  const fallback =
    lastActive && visible.includes(lastActive) ? lastActive : visible.length === 1 ? visible[0] : null;
  if (fallback && fallback.deliver(files)) ev.preventDefault();
};

let listening = false;
const ensureListener = () => {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('paste', onWindowPaste);
};

/**
 * 粘贴截图区域：一个可见的虚线框（像输入框一样可以点、可以聚焦）。
 * - 点一下框内任意位置后 Ctrl+V 就能粘贴微信/桌面截图；
 * - 支持一次粘贴多张（onFiles）；
 * - 支持把图片直接拖进框里；
 * - 页面上只有这一个粘贴框时，不点它直接 Ctrl+V 也能粘。
 */
const PasteImageBox: React.FC<Props> = ({
  onFile,
  onFiles,
  children,
  style,
  enableDrop = true,
  showHint = true,
  borderless = false,
  hint,
  disabled = false,
}) => {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const cbRef = React.useRef({ onFile, onFiles, disabled });
  cbRef.current = { onFile, onFiles, disabled };
  const [dragging, setDragging] = React.useState(false);

  const deliver = React.useCallback((files: File[]) => {
    const { onFile: single, onFiles: multi, disabled: off } = cbRef.current;
    if (off || !files.length) return false;
    if (multi) {
      multi(files);
      return true;
    }
    if (single) {
      single(files[0]);
      if (files.length > 1) message.info(`这里一次只收 1 张，已用第 1 张（共 ${files.length} 张）`);
      return true;
    }
    return false;
  }, []);

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    ensureListener();
    const entry: Entry = { el, deliver };
    registry.add(entry);
    const activate = () => {
      lastActive = entry;
    };
    el.addEventListener('focusin', activate);
    el.addEventListener('mousedown', activate);
    return () => {
      registry.delete(entry);
      if (lastActive === entry) lastActive = null;
      el.removeEventListener('focusin', activate);
      el.removeEventListener('mousedown', activate);
    };
  }, [deliver]);

  const handleDragOver = (e: React.DragEvent) => {
    if (!enableDrop || disabled) return;
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    if (!dragging) setDragging(true);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!enableDrop || disabled) return;
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files || []).filter(isImageFile);
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    deliver(files);
  };

  return (
    <div
      ref={boxRef}
      tabIndex={disabled ? -1 : 0}
      role="button"
      onClick={(e) => {
        if (!disabled) e.currentTarget.focus();
      }}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        outline: 'none',
        cursor: disabled ? 'not-allowed' : 'text',
        border: borderless ? 'none' : `1px dashed ${dragging ? BRAND.primary : '#d9d9d9'}`,
        borderRadius: 8,
        padding: borderless ? 0 : '10px 12px',
        background: borderless ? 'transparent' : dragging ? '#e6f4ff' : '#fafafa',
        transition: 'border-color .2s, background .2s',
        ...style,
      }}
    >
      {children}
      {showHint && (
        <div style={{ marginTop: children ? 6 : 0, fontSize: 12, color: dragging ? BRAND.primary : '#888' }}>
          {hint ??
            (dragging ? '松手即可上传' : '点一下这里，直接 Ctrl+V 粘贴截图（支持一次多张，也可以把图片拖进来）')}
        </div>
      )}
    </div>
  );
};

export default PasteImageBox;
