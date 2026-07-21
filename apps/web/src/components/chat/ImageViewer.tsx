// craftsman-ignore: TS001,TS002
import React, { useState } from 'react';
import { LeftOutlined, RightOutlined, CloseOutlined } from '@ant-design/icons';

interface ImageViewerProps {
  images: Array<{ url: string; thumbnailUrl?: string; width?: number; height?: number }>;
  initialIndex?: number;
  onClose: () => void;
}

const ImageViewer: React.FC<ImageViewerProps> = ({ images, initialIndex = 0, onClose }) => {
  const [index, setIndex] = useState(initialIndex);

  const prev = () => setIndex((i) => (i > 0 ? i - 1 : images.length - 1));
  const next = () => setIndex((i) => (i < images.length - 1 ? i + 1 : 0));

  const current = images[index];
  if (!current) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10001,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <CloseOutlined
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          color: '#FFF',
          fontSize: 24,
          cursor: 'pointer',
          zIndex: 2,
        }}
        onClick={onClose}
      />

      {images.length > 1 && (
        <>
          <LeftOutlined
            style={{
              position: 'absolute',
              left: 20,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#FFF',
              fontSize: 32,
              cursor: 'pointer',
              padding: 16,
            }}
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
          />
          <RightOutlined
            style={{
              position: 'absolute',
              right: 20,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#FFF',
              fontSize: 32,
              cursor: 'pointer',
              padding: 16,
            }}
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
          />
        </>
      )}

      <img
        src={current.url}
        alt=""
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '90vw',
          maxHeight: '90vh',
          objectFit: 'contain',
          borderRadius: 8,
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        }}
      />

      {images.length > 1 && (
        <div style={{ position: 'absolute', bottom: 24, color: '#FFF', fontSize: 13, opacity: 0.7 }}>
          {index + 1} / {images.length}
        </div>
      )}
    </div>
  );
};

export default ImageViewer;
