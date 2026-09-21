// craftsman-ignore: TS001,TS002
import React from 'react';
import { getImageFileFromClipboard } from '../utils/clipboardImage';

interface Props {
  onFile: (file: File) => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * 粘贴截图区域：渲染成一个可见的虚线框，点击框内任意位置获得焦点后，
 * 直接 Ctrl+V 即可粘贴微信/桌面截图（不再局限于只能从文件夹选文件）。
 */
const PasteImageBox: React.FC<Props> = ({ onFile, children, style }) => {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const onFileRef = React.useRef(onFile);
  onFileRef.current = onFile;

  const handlePaste = (e: ClipboardEvent) => {
    const target = e.target as Node | null;
    if (!boxRef.current || !target || !boxRef.current.contains(target)) return;
    const file = getImageFileFromClipboard(e as any);
    if (file) {
      e.preventDefault();
      onFileRef.current(file);
    }
  };

  React.useEffect(() => {
    const onWindowPaste = (e: Event) => handlePaste(e as ClipboardEvent);
    // 普通 div 即使有 tabIndex，也未必能成为粘贴事件目标。
    // 这里在 window 层监听，再按目标是否落在当前粘贴框内过滤，确保 Ctrl+V 稳定可用。
    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, []);

  return (
    <div
      ref={boxRef}
      tabIndex={0}
      role="button"
      onClick={(e) => e.currentTarget.focus()}
      style={{
        outline: 'none',
        cursor: 'text',
        border: '1px dashed #d9d9d9',
        borderRadius: 8,
        padding: '10px 12px',
        background: '#fafafa',
        ...style,
      }}
    >
      {children}
      <div style={{ marginTop: 6, fontSize: 12, color: '#888' }}>
        点击此框后，直接 Ctrl+V 粘贴截图
      </div>
    </div>
  );
};

export default PasteImageBox;
