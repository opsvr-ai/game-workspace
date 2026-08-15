// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { Card, Button, Input, InputNumber, Typography, Space, message, Row, Col } from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';

const { Text } = Typography;

interface GameEntry {
  game: string;
  hours: number;
}

const GameBreakEvenSettings: React.FC = () => {
  const [list, setList] = useState<GameEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await configApi.getAll();
      const v = data.data?.['dispatch.game_break_even_hours'];
      setList(Array.isArray(v) ? v : []);
    } catch {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  const update = (i: number, patch: Partial<GameEntry>) => {
    setList((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };

  const remove = (i: number) => setList((prev) => prev.filter((_, idx) => idx !== i));

  const add = () => setList((prev) => [...prev, { game: '', hours: 0 }]);

  const save = async () => {
    setSaving(true);
    try {
      const cleaned = list.map((it) => ({ game: String(it.game || '').trim(), hours: Number(it.hours || 0) }));
      await configApi.update({ 'dispatch.game_break_even_hours': cleaned });
      message.success('游戏平衡点已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="🎮 各游戏盈亏平衡点（小时）"
      extra={
        <Space>
          <Button icon={React.createElement(ReloadOutlined)} onClick={fetchList} loading={loading}>刷新</Button>
          <Button type="primary" icon={React.createElement(SaveOutlined)} loading={saving} onClick={save}>保存</Button>
        </Space>
      }
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        每个游戏填“新客首单平均需要带来多少小时续单/复购”才不亏。三角洲已填默认值，其他游戏你可自行填写。
      </Text>
      <Row gutter={[0, 10]}>
        {list.map((it, i) => (
          <Col span={24} key={i}>
            <Space>
              <Input
                style={{ width: 220 }}
                placeholder="游戏名"
                value={it.game}
                onChange={(e) => update(i, { game: e.target.value })}
              />
              <InputNumber
                min={0}
                step={0.1}
                style={{ width: 140 }}
                placeholder="小时"
                value={it.hours}
                onChange={(v) => update(i, { hours: v ?? 0 })}
              />
              <Text type="secondary">小时</Text>
              <Button danger icon={React.createElement(DeleteOutlined)} onClick={() => remove(i)} />
            </Space>
          </Col>
        ))}
      </Row>
      <Button style={{ marginTop: 12 }} icon={React.createElement(PlusOutlined)} onClick={add} block>
        添加新游戏
      </Button>
    </Card>
  );
};

export default GameBreakEvenSettings;
