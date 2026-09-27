import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { router } from './router';
import { chunlvTheme } from './theme';
import './styles/global.css';

const App: React.FC = () => {
  return (
    // button.autoInsertSpace=false：antd 默认会给「两个汉字」的按钮中间插一个空格，
    // 同一个列表里就出现「退 款」「沟 通」配「修改」「退款」这种一半有空格一半没有的样子，
    // 全站统一关掉（老板 2026-09-28：操作列很乱）。
    <ConfigProvider theme={chunlvTheme} locale={zhCN} button={{ autoInsertSpace: false }}>
      <AntApp>
        <RouterProvider router={router} />
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
