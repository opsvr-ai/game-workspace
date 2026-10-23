// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Switch, Typography } from 'antd';
import { message } from '../utils/feedback';
import { companionsApi } from '../api/companions';

/**
 * 陪玩端「通知设置」只保留一个开关（老板 2026-10-19）：
 *   「接单中弹窗」后面带 是 / 否。
 *
 * 别的筛选 / 娱乐中开关 / 全屏模式 / 音量全部收掉 —— 陪玩只需要决定一件事：
 * 正在接单时，新单还允不允许弹给我。
 *
 * 空闲、挂机（休息）仍然一律弹；这个开关只影响「接单中」。
 */
export default function OrderNotifySettingsPanel() {
  const [notifyWhileBusy, setNotifyWhileBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    companionsApi
      .notifyPrefs()
      .then(({ data }: any) => {
        const next = !!data?.data?.notifyWhileBusy;
        setNotifyWhileBusy(next);
        // 主进程弹 Windows 通知时要知道“接单中是否允许弹”，否则网页关了也拦不住。
        (window as any).electronAPI?.storeSet?.('notifyWhileBusy', next);
      })
      .catch(() => {});
  }, []);

  const save = async (next: boolean) => {
    setNotifyWhileBusy(next);
    setSaving(true);
    try {
      await companionsApi.setNotifyPrefs({ notifyWhileBusy: next });
      (window as any).electronAPI?.storeSet?.('notifyWhileBusy', next);
      message.success(next ? '已允许：接单中也会弹新单' : '已关闭：接单中不弹新单');
    } catch {
      setNotifyWhileBusy(!next);
      message.error('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Typography.Text strong>接单中弹窗</Typography.Text>
      <Switch
        checked={notifyWhileBusy}
        loading={saving}
        checkedChildren="是"
        unCheckedChildren="否"
        onChange={save}
      />
    </div>
  );
}
