import React from 'react';
import ReactDOM from 'react-dom/client';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import './index.css';
import { applyDataFontCssVars } from './constants/datasetColumns';

dayjs.locale('zh-cn');

// 订单 / 客户数据的统一字号：CSS 里统一读这几个变量，改字号只改 datasetColumns.ts
applyDataFontCssVars();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
