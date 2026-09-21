// craftsman-ignore: TS001,TS002
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Empty, Popconfirm, Select, Space, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';
import { studiosApi } from '../../api/studios';
import { useAuthStore } from '../../stores/authStore';

const { Text } = Typography;

/**
 * 设置中心的「这份设置是谁的」提示条。
 *
 * 老板 2026-09-21 最终口径：以后进来的租赁线下工作室、线上俱乐部，
 * **店长可以改自己店里的任何数据，店跟店相互独立**；只有影响数据安全与稳定性的才归老板
 * （密钥 / 凭据，以及一份值绑住全站的开关与版本号）。
 *
 * 所以设置分两层：
 * - 老板填的 = 全站默认值，所有店都跟着变；
 * - 店长填的 = 本店覆盖，只影响自己这家店，没填的项自动跟着老板的默认走。
 *
 * 这里解决两件最容易出错的事：
 * 1. 让店长一眼知道「我改的是本店」，以及极少数全站项（改了也会被跳过，并且有提示）；
 * 2. 给一个「恢复老板默认」的口子 —— 改坏了不用求人，一键回到默认值。
 */

/** 键 → 人话。没登记的就直接显示键名，至少不会指错。 */
const KEY_LABELS: Record<string, string> = {
  'revenue.share_tiers': '线下分成阶梯（工作室 / 陪玩）',
  'revenue.club_companion_share': '线上俱乐部固定分成（陪玩）',
  'revenue.free_threshold': '免单线（当日流水达标免娱乐费）',
  'revenue.low_warning': '低流水预警线',
  'commission.cs_offline_rate_percent': '客服提成 · 线下比例（%）',
  'commission.cs_offline_floor_cents': '客服提成 · 线下每单保底（分）',
  'commission.cs_offline_per_order_cap_cents': '客服提成 · 线下每单封顶（分）',
  'commission.cs_online_per_order_yuan': '客服提成 · 线上每单（元）',
  'commission.cs_bridge_per_order_yuan': '客服提成 · 桥接每单（元）',
  'commission.cs_bridge_min_threshold': '客服桥接阶梯 · 起步单量',
  'commission.cs_bridge_tier3_threshold': '客服桥接阶梯 · 第三档单量',
  'commission.cs_bridge_tier5_threshold': '客服桥接阶梯 · 第五档单量',
  'commission.cs_bridge_tier3_yuan': '客服桥接阶梯 · 第三档每单（元）',
  'commission.cs_bridge_tier5_yuan': '客服桥接阶梯 · 第五档每单（元）',
  'commission.cs_base_salary_yuan': '客服底薪（元）',
  'commission.cs_full_attendance_bonus_yuan': '客服全勤奖（元）',
  'commission.cs_early_leave_deduction_yuan': '客服早退扣款（元）',
  'commission.cs_daily_bridge_target': '客服每日桥接目标（单）',
  'commission.cs_bridge_miss_commission_rate': '客服未达标 · 提成比例（%）',
  'commission.cs_bridge_miss_salary_rate': '客服未达标 · 底薪比例（%）',
  'commission.admin_offline_rate_percent': '店长分成 · 线下（% 流水）',
  'commission.admin_online_rate_percent': '店长分成 · 线上（% 流水）',
  'bridge.secret_price_yuan': '机密桥接单价（元）',
  'bridge.jueju_net_yuan': '绝密桥接净收入（元）',
  'dispatch.bridge_return_jimi_cents': '桥接首单返款 · 机密（分/小时）',
  'dispatch.bridge_return_jueju_cents': '桥接首单返款 · 绝密（分/小时）',
  'dispatch.top_tier_daily_new_limit': '上等马 · 每日立即打名额',
  'dispatch.middle_tier_daily_new_limit': '中等马 · 每日立即打名额',
  'dispatch.low_tier_daily_new_limit': '下等马 · 每日立即打名额',
  'entertainment.hourly_rate': '娱乐费率（元/小时）',
  'entertainment.revenue_threshold': '娱乐免单线（当日流水）',
  'entertainment.deposit_threshold': '娱乐押金门槛（元）',
};

const labelOf = (key: string): string => KEY_LABELS[key] || key;

interface StudioOption {
  id: string;
  label: string;
}

const StudioConfigScopeBar: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'OWNER';

  const [meta, setMeta] = useState<any>(null);
  const [studios, setStudios] = useState<StudioOption[]>([]);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (studioId?: string) => {
    try {
      const { data } = await configApi.get(undefined, studioId);
      setMeta(data?.data?._meta ?? null);
    } catch {
      setMeta(null);
    }
  }, []);

  useEffect(() => {
    if (!isOwner) load(undefined);
  }, [isOwner, load]);

  // 老板要看「某家店自己填了什么」时才去拉工作室列表，不给普通用户多打一个请求
  useEffect(() => {
    if (!isOwner) return;
    studiosApi
      .list()
      .then(({ data }) => {
        const rows: any[] = data?.data ?? [];
        setStudios(
          rows.map((s) => ({
            id: s.id,
            label:
              (s.displayName || s.name || s.id) +
              (s.type === 'RENTAL' ? '（线上俱乐部）' : '（线下工作室）'),
          })),
        );
      })
      .catch(() => setStudios([]));
  }, [isOwner]);

  useEffect(() => {
    if (!isOwner || !picked) return;
    load(picked);
  }, [isOwner, picked, load]);

  const overridden: string[] = Array.isArray(meta?.overridden) ? meta.overridden : [];

  const reset = async (keys?: string[]) => {
    setBusy(true);
    try {
      await configApi.resetStudioOverrides(keys, isOwner ? picked : undefined);
      message.success('已恢复用老板的默认值');
      await load(isOwner ? picked : undefined);
    } catch {
      message.error('恢复默认失败');
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  // ── 店长视角 ──
  if (!isOwner) {
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="这里是本店自己的设置（店长填写）"
        description={
          <div style={{ fontSize: 12, lineHeight: '20px' }}>
            <div>
              这页上的设置<span style={{ fontWeight: 600 }}>你都能改，而且只影响本店</span>
              ，别的工作室不受影响；没动过的项自动用老板给的全站默认值。
            </div>
            <div>
              只有「杀黑名单开关、AI 密钥、语音服务器凭据、客户端与网页版本号」这类
              <span style={{ fontWeight: 600 }}>一份值管全站、会影响数据安全与稳定性</span>
              的项归老板。保存时如果带了这些，会明确提示哪些没改动，不会悄悄丢掉。
            </div>
            {overridden.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <Text strong>本店已自定义 {overridden.length} 项：</Text>
                <span style={{ marginLeft: 4 }}>
                  {overridden.map((k) => (
                    <Tag key={k} style={{ marginBottom: 4 }}>
                      {labelOf(k)}
                    </Tag>
                  ))}
                </span>
                <Popconfirm
                  title="这些项会全部改回老板的默认值，确定？"
                  onConfirm={() => reset()}
                >
                  <Button size="small" icon={<ReloadOutlined />} loading={busy} style={{ marginLeft: 4 }}>
                    全部恢复默认
                  </Button>
                </Popconfirm>
              </div>
            )}
          </div>
        }
      />
    );
  }

  // ── 老板视角 ──
  return (
    <Alert
      type="success"
      showIcon
      style={{ marginBottom: 12 }}
      message="你是老板：这里改的是全站默认值，所有工作室 / 线上俱乐部都跟着变"
      description={
        <div style={{ fontSize: 12, lineHeight: '20px' }}>
          <div>某家店自己填过的项会覆盖你的默认值。想看 / 清掉某家店的自定义，在下面选那家店。</div>
          <Space style={{ marginTop: 6 }} wrap>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="选一家工作室 / 线上俱乐部"
              style={{ width: 300 }}
              value={picked}
              onChange={(v) => setPicked(v)}
              options={studios.map((s) => ({ value: s.id, label: s.label }))}
            />
            {picked && overridden.length > 0 && (
              <Popconfirm
                title="这家店的自定义会全部改回你的默认值，确定？"
                onConfirm={() => reset()}
              >
                <Button size="small" icon={<ReloadOutlined />} loading={busy}>
                  这家店全部恢复默认
                </Button>
              </Popconfirm>
            )}
          </Space>
          {picked && (
            <div style={{ marginTop: 8 }}>
              {overridden.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="这家店没有任何自定义，全部在用你的默认值"
                />
              ) : (
                <div>
                  <Text strong>这家店自定义了 {overridden.length} 项：</Text>
                  <div style={{ marginTop: 4 }}>
                    {overridden.map((k) => (
                      <Tag key={k} style={{ marginBottom: 4 }}>
                        {labelOf(k)}
                        <Popconfirm
                          title="这一项改回你的默认值？"
                          onConfirm={() => reset([k])}
                        >
                          <a style={{ marginLeft: 6 }}>恢复</a>
                        </Popconfirm>
                      </Tag>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      }
    />
  );
};

export default StudioConfigScopeBar;
