// craftsman-ignore: TS001,TS002,TS003
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, DatePicker, Form, Input, InputNumber, message, Select, Space, Table, Typography } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { payrollApi } from '../../api/payroll';
import { configApi } from '../../api/config';
import { useAuthStore } from '../../stores/authStore';

const { Title, Text } = Typography;

/**
 * 工资规则（2026-09-22 合并，老板「一样的功能全部放在一起，要不然乱七八糟」）
 *
 * 以前「客服设置」和「店长设置」各装了一半「底薪 + 月休 + 考勤扣款」，
 * 其实是**同一张工资表的两个岗位行**，散在两页很容易改漏一个、也看不清全貌。
 * 现在收成一页：店长 / 客服 一岗一行，横向是 基本工资 / 月休天数 / 迟到扣款 / 缺勤扣款，
 * 再加两项**只有客服参与结算**的「早退扣款 / 全勤奖」。
 *
 * 陪玩故意不在这张表里：陪玩的收入 100% 来自提成（「设置 → 利润分成（分账规则）」按流水档位设），
 * 系统里没有陪玩底薪，摆一行出来只会让人以为填了有用。
 *
 * 两个岗位的底薪都写进 `PayrollConfig`（`POST /api/payroll/configs`，按 role upsert）；
 * 只有客服的「早退扣款 / 全勤奖」存在系统配置里（`commission.cs_early_leave_deduction_yuan` /
 * `commission.cs_full_attendance_bonus_yuan`，客服提成结算读的就是这两个键）。
 * 客服底薪在系统配置里还有一份兜底值（结算优先读 PayrollConfig），保存时一起写，保证两边永远一致。
 */

/** 岗位色，和「分账规则」同一套：店长蓝 / 客服橙 */
const ROLE_TINT = { ADMIN: '#3B82F6', CS: '#F59E0B' } as const;

const CELL: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  fontSize: 13,
  lineHeight: '22px',
  borderTop: '1px solid #eef2f7',
  minWidth: 0,
};
const HEAD_CELL: React.CSSProperties = {
  ...CELL,
  borderTop: 'none',
  background: '#f1f5f9',
  color: '#334155',
  fontSize: 12,
};
const LABEL_CELL: React.CSSProperties = {
  ...CELL,
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 0,
  background: '#f8fafc',
};
/** 岗位列 + 6 个数字列；窄窗口横向滚动，不把输入框挤扁（老板 2026-09-22 提过挤到点不到） */
const GRID_COLS = '150px repeat(6, minmax(150px, 1fr))';

interface WageRow {
  baseSalary: number;
  fullAttendanceDays: number;
  lateDeduction: number;
  absentDeduction: number;
}

const newRow = (): WageRow => ({ baseSalary: 0, fullAttendanceDays: 4, lateDeduction: 0, absentDeduction: 0 });

const PayrollPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  // 店长不能给自己定工资（服务端 `POST /payroll/configs` 也会直接拒），所以那一行对店长只读
  const isAdmin = user?.role === 'ADMIN';

  const [adminRow, setAdminRow] = useState<WageRow>(newRow());
  const [csRow, setCsRow] = useState<WageRow>(newRow());
  const [csEarlyLeave, setCsEarlyLeave] = useState(0);
  const [csFullAttendanceBonus, setCsFullAttendanceBonus] = useState(0);

  const [staff, setStaff] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [attForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, payrollRes, staffRes, recRes] = await Promise.all([
        configApi.getAll(),
        payrollApi.configs(),
        payrollApi.staff(),
        payrollApi.records(month),
      ]);
      const cfg = (cfgRes.data as any)?.data || {};
      const list = (payrollRes.data as any)?.data || [];
      const pick = (role: string): WageRow => {
        const row = list.find((p: any) => p.role === role) || {};
        return {
          baseSalary: Number(row.baseSalary ?? 0),
          fullAttendanceDays: Number(row.fullAttendanceDays ?? 4),
          lateDeduction: Number(row.lateDeduction ?? 0),
          absentDeduction: Number(row.absentDeduction ?? 0),
        };
      };
      setAdminRow(pick('ADMIN'));
      setCsRow(pick('CS'));
      setCsEarlyLeave(Number(cfg['commission.cs_early_leave_deduction_yuan'] ?? 0));
      setCsFullAttendanceBonus(Number(cfg['commission.cs_full_attendance_bonus_yuan'] ?? 0));
      setStaff((staffRes.data as any)?.data || []);
      setRecords((recRes.data as any)?.data || []);
    } catch {
      message.error('加载工资规则失败');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const tasks: Promise<any>[] = [
        payrollApi.saveConfig({ role: 'CS', ...csRow }),
        configApi.update({
          // 结算优先读上面那张表，这份是兜底值，两边必须一致
          'commission.cs_base_salary_yuan': csRow.baseSalary,
          'commission.cs_early_leave_deduction_yuan': csEarlyLeave,
          'commission.cs_full_attendance_bonus_yuan': csFullAttendanceBonus,
        }),
      ];
      if (!isAdmin) tasks.push(payrollApi.saveConfig({ role: 'ADMIN', ...adminRow }));
      await Promise.all(tasks);
      message.success(isAdmin ? '客服工资已保存（店长工资只有老板能改）' : '工资规则已保存');
      await load();
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const markAttendance = async (values: any) => {
    await payrollApi.attendance({
      userId: values.userId,
      date: values.date.format('YYYY-MM-DD'),
      status: values.status,
    });
    message.success('考勤已记录');
    attForm.resetFields();
  };

  const generate = async () => {
    setLoading(true);
    try {
      const { data } = await payrollApi.generate(month);
      setRecords((data as any)?.data || []);
      message.success('工资核算完成');
    } finally {
      setLoading(false);
    }
  };

  /** 数字输入：右边跟一个小字单位，全页字号统一 */
  const num = (
    value: number,
    onChange: (v: number) => void,
    unit: string,
    opts?: { step?: number; min?: number },
  ) => (
    <Space size={4}>
      <InputNumber
        min={opts?.min ?? 0}
        step={opts?.step ?? 1}
        value={value}
        onChange={(v) => onChange(Number(v ?? 0))}
        style={{ width: 110 }}
      />
      <Text type="secondary">{unit}</Text>
    </Space>
  );

  const lockedValue = (value: number, unit: string) => (
    <Text strong style={{ fontSize: 14, color: '#1677ff' }}>{`${value} ${unit}`}</Text>
  );

  const dash = <Text type="secondary">—</Text>;

  const roleRow = (
    role: 'ADMIN' | 'CS',
    name: string,
    note: string,
    row: WageRow,
    setRow: (r: WageRow) => void,
    locked: boolean,
  ) => (
    <React.Fragment key={role}>
      <div style={{ ...LABEL_CELL, borderLeft: `3px solid ${ROLE_TINT[role]}`, background: `${ROLE_TINT[role]}0A` }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="ui-dot" style={{ background: ROLE_TINT[role] }} />
          <Text strong style={{ fontSize: 13 }}>{name}</Text>
        </span>
        <Text type="secondary" style={{ fontSize: 11, lineHeight: '16px' }}>{note}</Text>
      </div>
      <div style={CELL}>
        {locked ? lockedValue(row.baseSalary, '元/月') : num(row.baseSalary, (v) => setRow({ ...row, baseSalary: v }), '元/月', { step: 100 })}
      </div>
      <div style={CELL}>
        {locked ? lockedValue(row.fullAttendanceDays, '天') : num(row.fullAttendanceDays, (v) => setRow({ ...row, fullAttendanceDays: v }), '天')}
      </div>
      <div style={CELL}>
        {locked ? lockedValue(row.lateDeduction, '元/次') : num(row.lateDeduction, (v) => setRow({ ...row, lateDeduction: v }), '元/次')}
      </div>
      <div style={CELL}>
        {locked ? lockedValue(row.absentDeduction, '元/天') : num(row.absentDeduction, (v) => setRow({ ...row, absentDeduction: v }), '元/天')}
      </div>
      <div style={CELL}>{role === 'CS' ? num(csEarlyLeave, setCsEarlyLeave, '元/次') : dash}</div>
      <div style={CELL}>{role === 'CS' ? num(csFullAttendanceBonus, setCsFullAttendanceBonus, '元/月', { step: 10 }) : dash}</div>
    </React.Fragment>
  );

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>工资规则</Title>
        <Text type="secondary">
          工资 = 基本工资 + 提成 − 考勤扣款。店长 / 客服的底薪、月休与考勤扣款全在这一页；
          提成（四个人分成）在「设置 → 系统配置 → 利润分成（分账规则）」里设。
        </Text>
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
        <Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving}>保存全部</Button>
      </Space>

      <Card size="small" title="💰 各岗位工资规则" style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          陪玩不在这张表里：陪玩的收入全部是提成（按流水档位在「分账规则」里设），系统里没有陪玩底薪。
          「早退扣款 / 全勤奖」目前只有客服参与结算，所以只有客服那一行能填。
          {isAdmin && ' 店长工资由老板设置，这一行你只能看。'}
        </Text>
        <div style={{ marginTop: 12, border: '1px solid #eef2f7', borderRadius: 10, overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: GRID_COLS, minWidth: 1080 }}>
            <div style={{ ...HEAD_CELL, flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
              <Text strong style={{ fontSize: 12 }}>岗位</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>同一张工资表的两行</Text>
            </div>
            <div style={{ ...HEAD_CELL, flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
              <Text strong style={{ fontSize: 12 }}>基本工资</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>元 / 月</Text>
            </div>
            <div style={{ ...HEAD_CELL, flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
              <Text strong style={{ fontSize: 12 }}>月休天数</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>满勤 = 当月天数 − 月休</Text>
            </div>
            <div style={{ ...HEAD_CELL, flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
              <Text strong style={{ fontSize: 12 }}>迟到扣款</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>元 / 次</Text>
            </div>
            <div style={{ ...HEAD_CELL, flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
              <Text strong style={{ fontSize: 12 }}>缺勤扣款</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>元 / 天（月休内不扣）</Text>
            </div>
            <div style={{ ...HEAD_CELL, flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
              <Text strong style={{ fontSize: 12 }}>早退扣款</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>元 / 次 · 客服专用</Text>
            </div>
            <div style={{ ...HEAD_CELL, flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
              <Text strong style={{ fontSize: 12 }}>全勤奖</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>元 / 月 · 客服专用</Text>
            </div>

            {roleRow('ADMIN', '店长', isAdmin ? '店长工资只有老板能改' : '全店统一', adminRow, setAdminRow, isAdmin)}
            {roleRow('CS', '客服', '按单量另有提成，见「分账规则」', csRow, setCsRow, false)}
          </div>
        </div>
      </Card>

      <Card size="small" title="🗓 考勤登记（店长 / 客服）" style={{ marginBottom: 16 }}>
        <Form form={attForm} layout="inline" onFinish={markAttendance}>
          <Form.Item name="userId" label="员工" rules={[{ required: true }]}>
            <Select style={{ width: 160 }} options={staff.map((s) => ({ value: s.id, label: s.username }))} />
          </Form.Item>
          <Form.Item name="date" label="日期" rules={[{ required: true }]}><DatePicker /></Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}>
            <Select style={{ width: 140 }} options={[
              { value: 'PRESENT', label: '正常' },
              { value: 'LATE', label: '迟到' },
              { value: 'EARLY_LEAVE', label: '早退' },
              { value: 'ABSENT', label: '缺勤' },
            ]} />
          </Form.Item>
          <Button type="primary" htmlType="submit">登记</Button>
        </Form>
        <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          登记「早退」后，客服的「早退扣款」才会真的扣（以前这个选项没地方登记，等于填了不生效）。
          陪玩的考勤是客户端自动记录的，在「考勤管理」里查。
        </Text>
      </Card>

      <Card size="small" title="🧾 工资表">
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <Input value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 140 }} placeholder="YYYY-MM" />
          <Button type="primary" onClick={generate} loading={loading}>生成本月工资</Button>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={records}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: '姓名', dataIndex: 'username', render: (v: string) => v || '-' },
            { title: '岗位', dataIndex: 'role', render: (v: string) => (v === 'ADMIN' ? '店长' : v === 'CS' ? '客服' : (v || '-')) },
            { title: '月份', dataIndex: 'month' },
            { title: '基本工资', dataIndex: 'baseSalary', render: (v: number) => `¥${Number(v || 0).toFixed(1)}` },
            { title: '提成', dataIndex: 'performanceSalary', render: (v: number) => `¥${Number(v || 0).toFixed(1)}` },
            { title: '考勤扣款', dataIndex: 'attendanceDeduction', render: (v: number) => `¥${Number(v || 0).toFixed(1)}` },
            { title: '出勤/满勤', dataIndex: 'fullAttendance', render: (_: number, r: any) => `${r.attendanceDays || 0} / ${r.fullAttendance ?? '-'} 天` },
            { title: '应发工资', dataIndex: 'totalSalary', render: (v: number) => `¥${Number(v || 0).toFixed(1)}` },
            { title: '状态', dataIndex: 'status' },
          ]}
        />
      </Card>
    </div>
  );
};

export default PayrollPage;
