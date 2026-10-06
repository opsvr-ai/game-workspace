// craftsman-ignore: TS001,TS002
import React, { useCallback, useEffect, useState } from 'react';
import { Card, Typography, Tag, Input, Button, Space} from 'antd';
import { message } from '../utils/feedback';
import http from '../api/client';

const { Text } = Typography;

/**
 * 陪玩自己填写 / 更换工作微信（老板 2026-10-02）。
 *
 *   「让陪玩自己填写自己的微信号，但是需要管理端审核，以后想换可以换，
 *    但是管理端审核过了以后才显示新的。」
 *
 * 所以这里只是「提交申请」；真正生效（界面上显示、抢单判重用）的仍是管理端审核通过的那个号。
 * 审核中的申请用 Tag 标出来，不会顶掉当前生效的号。
 */
const MyWorkWechatCard: React.FC = () => {
  const [state, setState] = useState<any>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await http.get('/companions/me/work-wechat');
      setState(data?.data ?? null);
    } catch {
      /* 非关键信息，拉不到就先不显示 */
    }
  }, []);

  useEffect(() => {
    load();
    // 管理端审核通过后不用刷新页面也能看到新号（30 秒对一次 + 切回窗口时对一次）
    const timer = setInterval(load, 30000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const submit = async () => {
    const v = draft.trim();
    if (!v) {
      message.warning('请输入你的微信号');
      return;
    }
    setSaving(true);
    try {
      await http.post('/companions/me/work-wechat', { wechatId: v });
      message.success('已提交，等管理端审核；审核通过后才会生效');
      setDraft('');
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '提交失败');
    } finally {
      setSaving(false);
    }
  };

  const effective = state?.effective as string | null | undefined;
  const pending = state?.pending;
  const rejected = state?.lastRejected;

  return (
    <Card
      size="small"
      style={{
        marginBottom: 12,
        border: effective ? '1px solid #E2E8F0' : '1px solid #ffccc7',
        background: effective ? undefined : '#fff2f0',
      }}
    >
      <Space size={12} wrap align="center">
        <Text strong>📱 我的工作微信</Text>
        {effective ? (
          <Tag color="blue">{effective}</Tag>
        ) : (
          <Tag color="red">还没绑定 · 现在抢不了单</Tag>
        )}
        {pending && <Tag color="orange">审核中：{pending.wechatId}</Tag>}
      </Space>

      <div style={{ marginTop: 6 }}>
        {effective ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            换号也可以：填新号提交，管理端审核通过之前，系统还是用上面这个号。
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            填上你自己在用的工作微信号，提交给管理端审核；审核通过后就能抢单了。
          </Text>
        )}
        {rejected && !pending && (
          <div style={{ marginTop: 2 }}>
            <Text type="secondary" style={{ fontSize: 12, color: '#cf1322' }}>
              上次提交的「{rejected.wechatId}」没通过{rejected.reason ? `：${rejected.reason}` : ''}
            </Text>
          </div>
        )}
      </div>

      <Space.Compact style={{ marginTop: 8, width: '100%', maxWidth: 420 }}>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={submit}
          placeholder="填你自己的微信号（例如 hanlei2026）"
          allowClear
        />
        <Button type="primary" loading={saving} onClick={submit}>
          {pending ? '改成这个号' : effective ? '换号（提交审核）' : '提交审核'}
        </Button>
      </Space.Compact>
    </Card>
  );
};

export default MyWorkWechatCard;
