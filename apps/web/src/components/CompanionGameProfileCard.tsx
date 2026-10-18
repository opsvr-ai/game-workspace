import React, { useEffect, useState } from 'react';
import { Button, Card, Checkbox, Select, Tag, Typography } from 'antd';
import http from '../api/client';
import { message } from '../utils/feedback';
import { BORDER } from '../styles/tokens';

const { Text } = Typography;

interface GameProfile {
  game: string;
  rank: string;
  hasAccount: boolean;
}

/**
 * 陪玩的「游戏资料」卡（2026-10-18 从独立 /profile-setup 页并进个人设置）。
 *
 * 原来首次登录会把人踢到一个整页表单；现在个人设置里直接改，能力不丢。
 * 只有陪玩账号显示；店长 / 客服 / 老板看不到。
 */
const CompanionGameProfileCard: React.FC = () => {
  const userStr = sessionStorage.getItem('user');
  const user = userStr ? JSON.parse(userStr) : null;
  const [games, setGames] = useState<string[]>([]);
  const [ranks, setRanks] = useState<string[]>(['青铜', '白银', '黄金', '铂金', '钻石', '大师', '宗师', '王者']);
  const [selected, setSelected] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<Record<string, GameProfile>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user?.role !== 'COMPANION') return;
    http.get('/settings').then(({ data }) => {
      setGames(data.data?.games ?? []);
      if (Array.isArray(data.data?.ranks) && data.data.ranks.length) setRanks(data.data.ranks);
    }).catch(() => {});
  }, [user?.role]);

  if (user?.role !== 'COMPANION') return null;

  const toggle = (game: string) => {
    setSelected((prev) => {
      if (prev.includes(game)) {
        const next = { ...profiles };
        delete next[game];
        setProfiles(next);
        return prev.filter((g) => g !== game);
      }
      setProfiles((p) => ({ ...p, [game]: { game, rank: '', hasAccount: false } }));
      return [...prev, game];
    });
  };

  const update = (game: string, field: 'rank' | 'hasAccount', value: any) => {
    setProfiles((p) => ({ ...p, [game]: { ...p[game], [field]: value } }));
  };

  const save = async () => {
    const list = Object.values(profiles).filter((p) => p.game);
    if (!list.length) {
      message.warning('请至少选择一个游戏');
      return;
    }
    setSaving(true);
    try {
      await http.put(`/companions/${user.companionId}/profile`, { gameProfiles: list });
      message.success('游戏资料已保存');
    } catch (err: any) {
      message.error(err?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card size="small" title="游戏资料" style={{ marginTop: 12 }}>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        选择你会的游戏，并设置段位 / 是否有账号。店长在排单和定级时会看这份资料。
      </Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {games.map((g) => (
          <Tag.CheckableTag
            key={g}
            checked={selected.includes(g)}
            onChange={() => toggle(g)}
            style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${BORDER.base}` }}
          >
            {g}
          </Tag.CheckableTag>
        ))}
        {!games.length && <Text type="secondary">暂无可选游戏，请联系店长在「系统配置」里维护。</Text>}
      </div>
      {selected.map((game) => (
        <div key={game} style={{ padding: '10px 0', borderTop: `1px solid ${BORDER.base}` }}>
          <Text strong style={{ marginRight: 12 }}>{game}</Text>
          <Select
            size="small"
            placeholder="段位"
            value={profiles[game]?.rank || undefined}
            onChange={(v) => update(game, 'rank', v)}
            options={ranks.map((r) => ({ value: r, label: r }))}
            style={{ width: 140, marginRight: 16 }}
          />
          <Checkbox
            checked={profiles[game]?.hasAccount}
            onChange={(e) => update(game, 'hasAccount', e.target.checked)}
          >
            有游戏账号
          </Checkbox>
        </div>
      ))}
      <Button type="primary" loading={saving} onClick={save} style={{ marginTop: 16 }}>
        保存游戏资料
      </Button>
    </Card>
  );
};

export default CompanionGameProfileCard;
