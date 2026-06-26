import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Select, Button, Typography, message, Checkbox, Tag, Row, Col } from 'antd';
import http from '../api/client';
import { useAuthStore } from '../stores/authStore';

const { Text } = Typography;
const { Option } = Select;

interface GameProfile { game: string; rank: string; hasAccount: boolean; }
const RANK_DEFAULT = ['青铜', '白银', '黄金', '铂金', '钻石', '大师', '宗师', '王者'];

const ProfileSetupPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [gameOptions, setGameOptions] = useState<string[]>([]);
  const [rankOptions, setRankOptions] = useState<string[]>(RANK_DEFAULT);
  const [selectedGames, setSelectedGames] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<Record<string, GameProfile>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || user.role !== 'COMPANION') { navigate('/login', { replace: true }); return; }
    http.get('/settings').then(({ data }) => {
      setGameOptions(data.data?.games ?? []);
      if (data.data?.ranks) setRankOptions(data.data.ranks);
    }).catch(() => {});
  }, [user, navigate]);

  const toggleGame = (game: string) => {
    setSelectedGames((prev) => {
      if (prev.includes(game)) {
        const next = { ...profiles }; delete next[game]; setProfiles(next);
        return prev.filter((g) => g !== game);
      }
      setProfiles((p) => ({ ...p, [game]: { game, rank: '', hasAccount: false } }));
      return [...prev, game];
    });
  };

  const updateProfile = (game: string, field: 'rank' | 'hasAccount', value: any) => {
    setProfiles((p) => ({ ...p, [game]: { ...p[game], [field]: value } }));
  };

  const handleSave = async () => {
    const list = Object.values(profiles).filter((p) => p.game);
    if (list.length === 0) { message.warning('请至少选择一个游戏'); return; }
    setSaving(true);
    try {
      await http.put(`/companions/${user!.companionId}/profile`, { gameProfiles: list });
      message.success('资料已保存');
      window.location.href = '/';
    } catch (err: any) {
      message.error(err?.response?.data?.message || '保存失败');
    } finally { setSaving(false); }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', padding: '40px 0' }}>
      <div style={{ maxWidth: 700, margin: '0 auto', background: '#FFF', borderRadius: 16, padding: 40, boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
        <h2 style={{ textAlign: 'center', fontSize: 22, fontWeight: 700, marginBottom: 4 }}>完善陪玩资料</h2>
        <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 24 }}>
          选择游戏后为每个游戏设置段位和账号情况
        </Text>

        <Text strong style={{ fontSize: 14, marginBottom: 10, display: 'block' }}>选择游戏：</Text>
        <div style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {gameOptions.map((g) => (
            <Tag.CheckableTag key={g} checked={selectedGames.includes(g)} onChange={() => toggleGame(g)}
              style={{ padding: '6px 14px', fontSize: 14, borderRadius: 6, border: '1px solid #E2E8F0' }}>
              {g}
            </Tag.CheckableTag>
          ))}
        </div>

        {selectedGames.length > 0 && (
          <>
            <Text strong style={{ fontSize: 14, marginBottom: 12, display: 'block' }}>设置每个游戏的详情：</Text>
            <Row gutter={[12, 12]}>
              {selectedGames.map((game) => (
                <Col span={12} key={game}>
                  <Card size="small" title={<span style={{ fontSize: 13 }}>{game}</span>}
                    style={{ borderRadius: 10, border: '1px solid #E2E8F0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <Select size="small" placeholder="段位" value={profiles[game]?.rank || undefined}
                        onChange={(v) => updateProfile(game, 'rank', v)} style={{ width: '100%' }}>
                        {rankOptions.map((r) => <Option key={r} value={r}>{r}</Option>)}
                      </Select>
                      <Checkbox checked={profiles[game]?.hasAccount}
                        onChange={(e) => updateProfile(game, 'hasAccount', e.target.checked)}>
                        有游戏账号
                      </Checkbox>
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          </>
        )}

        <Button type="primary" size="large" block loading={saving} onClick={handleSave}
          style={{ height: 46, fontSize: 16, fontWeight: 600, borderRadius: 10, marginTop: 24,
            background: 'linear-gradient(135deg, #7B61FF, #00D4FF)', border: 'none', color: '#FFF' }}>
          💾 保存资料
        </Button>
      </div>
    </div>
  );
};

export default ProfileSetupPage;
