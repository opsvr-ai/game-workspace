import React from 'react';
import { Spin } from 'antd';

// Minimal shell — the web app loads directly into the BrowserWindow.
// This component only shows while Electron is initializing.
const App: React.FC = () => (
  <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0F172A' }}>
    <Spin size="large">
      <div style={{ color: '#94A3B8', marginTop: 16 }}>加载中...</div>
    </Spin>
  </div>
);

export default App;
