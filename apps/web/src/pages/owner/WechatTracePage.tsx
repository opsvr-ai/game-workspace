import React, { useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, Space, Tag, Typography, message } from 'antd';
import { watermarkApi } from '../../api/watermark';

const { Text, Paragraph, Title } = Typography;

/**
 * 微信号溯源（客户微信隐形水印解码）—— 老板 2026-10-04。
 *
 * 每一段客户微信号从系统里出去时，都带着一串看不见的字符（里面是「哪个账号、哪一天」）。
 * 陪玩把微信号复制出去 / 转发出去，这串字符会跟着走。把可疑文本粘到这里，
 * 就能查出是谁、哪天看到的。
 *
 * 覆盖不到的情况（页面也写清楚，省得老板白试）：
 *  · 截图 / 手打的文本 —— 隐形字符不会进图片，也复制不到；这种情况看画面上的淡色水印。
 */
const WechatTracePage: React.FC = () => {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    const raw = text.trim();
    if (!raw) return message.warning('先把你手上那段可疑文本粘进来');
    setLoading(true);
    try {
      const { data } = await watermarkApi.decode(text);
      setResult((data as any)?.data || null);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '查询失败，稍后再试');
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setText('');
    setResult(null);
  };

  return (
    <div style={{ maxWidth: 880 }}>
      <Title level={4} style={{ marginBottom: 4 }}>
        微信号溯源（隐形水印）
      </Title>
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        客户微信号从系统里出去时会带一串<b>看不见</b>的字符（记着「哪个账号 + 哪一天」）。
        陪玩把它复制 / 转发给别人，这串字符会跟着走 —— 你把手上的可疑文本粘进来，我就告诉你这是谁漏的。
      </Paragraph>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Input.TextArea
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            '把可疑文本粘进来（必须是「复制粘贴」的文本）：例如别人转发给你的那个客户微信号，\n或者一整条聊天记录 —— 里面只要有一点是复制出去的，我就能揪出来。'
          }
        />
        <Space style={{ marginTop: 12 }}>
          <Button type="primary" loading={loading} onClick={run}>
            查一下是谁漏的
          </Button>
          <Button onClick={clear}>清空</Button>
        </Space>
      </Card>

      {result?.matched && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message={result.summary}
          description={
            <Descriptions size="small" column={1} style={{ marginTop: 8 }}>
              <Descriptions.Item label="账号">
                {result.displayName || '-'}
                {result.username ? <Text type="secondary">（{result.username}）</Text> : null}
              </Descriptions.Item>
              <Descriptions.Item label="身份">
                <Space size={6}>
                  <Tag color={result.role === 'OWNER' ? 'gold' : result.role === 'ADMIN' ? 'geekblue' : result.role === 'CS' ? 'cyan' : 'green'}>
                    {result.role === 'OWNER'
                      ? '老板'
                      : result.role === 'ADMIN'
                        ? '店长'
                        : result.role === 'CS'
                          ? '客服'
                          : result.role === 'COMPANION'
                            ? '陪玩'
                            : result.role}
                  </Tag>
                  {result.studioName ? <Text type="secondary">{result.studioName}</Text> : null}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="哪天看到的">{result.day}</Descriptions.Item>
            </Descriptions>
          }
        />
      )}

      {result && !result.matched && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="没查到是谁"
          description={<div style={{ whiteSpace: 'pre-wrap' }}>{result.reason}</div>}
        />
      )}

      <Card size="small" title="什么情况能查、什么情况查不到">
        <Paragraph style={{ marginBottom: 8 }}>
          ✅ <b>能查</b>：别人把客户微信号 / 聊天记录<b>复制粘贴</b>给你（微信、QQ 转发文字都可以，粘进上面就行）。
        </Paragraph>
        <Paragraph style={{ marginBottom: 8 }}>
          🖼️ <b>截图 / 拍照</b>：隐形字符不进图片，这里查不到 —— 但画面上铺了一层<b>很淡的名字和日期</b>
          （每台电脑显示的是「谁在用这台电脑 + 当天日期」），你放大看截图就能认出来是谁漏的。
        </Paragraph>
        <Paragraph style={{ marginBottom: 0 }}>
          ⌨️ <b>手打</b>：对方要是照着屏幕一个字一个字敲出去的，任何技术都追不回来 —— 那种只能靠别的证据。
        </Paragraph>
      </Card>
    </div>
  );
};

export default WechatTracePage;