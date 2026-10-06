import React, { useState, useEffect, useCallback, createElement, useMemo } from 'react';
import { Table, Tag, Typography, DatePicker, Select, Button, Space, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import http from '../../api/client';
import PageHeader from '../../components/PageHeader';
import type { Dayjs } from 'dayjs';

const { Text } = Typography;
const { RangePicker } = DatePicker;

interface AttendanceRecord {
  id: string;
  companionId: string;
  companionName: string;
  date: string;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  durationHours?: number | null;
  isLate: boolean;
  isEarlyLeave: boolean;
  status: string; // NORMAL / LATE / EARLY_LEAVE / ABSENT / LATE_AND_EARLY
}

interface StaffAttendanceRecord {
  id: string;
  date: string;
  loginAt?: string | null;
  logoutAt?: string | null;
  status: string;
  user?: { username?: string; displayName?: string; role?: string } | null;
}

const staffStatusConfig: Record<string, { color: string; label: string }> = {
  PRESENT: { color: 'green', label: '正常' },
  LATE: { color: 'orange', label: '迟到' },
  EARLY_LEAVE: { color: 'gold', label: '早退' },
  ABSENT: { color: 'red', label: '缺勤' },
};

const roleLabel = (role?: string) => (role === 'ADMIN' ? '店长' : role === 'CS' ? '客服' : role || '-');
const hm = (v?: string | null) => (v ? new Date(v).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '-');

const statusConfig: Record<string, { color: string; label: string }> = {
  NORMAL: { color: 'green', label: '正常' },
  LATE: { color: 'orange', label: '迟到' },
  EARLY_LEAVE: { color: 'gold', label: '早退' },
  ABSENT: { color: 'red', label: '缺勤' },
  LATE_AND_EARLY: { color: 'volcano', label: '迟到+早退' },
};

const AttendancePage: React.FC = () => {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [companionFilter, setCompanionFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [companions, setCompanions] = useState<{ id: string; user?: { username: string } }[]>([]);
  // 客服 / 店长考勤（老板 2026-10-04：这三个职位都要考勤）
  const [staffRecords, setStaffRecords] = useState<StaffAttendanceRecord[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (dateRange) {
        params.startDate = dateRange[0].format('YYYY-MM-DD');
        params.endDate = dateRange[1].format('YYYY-MM-DD');
      }
      if (companionFilter) params.companionId = companionFilter;
      if (statusFilter) params.status = statusFilter;
      const { data } = await http.get('/companions/attendance', { params });
      setRecords(data.data?.items ?? data.data ?? []);
    } catch (err: any) {
      message.error('加载考勤数据失败');
    } finally {
      setLoading(false);
    }
  }, [dateRange, companionFilter, statusFilter]);

  const fetchStaffRecords = useCallback(async () => {
    setStaffLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (dateRange) {
        params.startDate = dateRange[0].format('YYYY-MM-DD');
        params.endDate = dateRange[1].format('YYYY-MM-DD');
      }
      const { data } = await http.get('/companions/staff-attendance', { params });
      setStaffRecords(data.data ?? []);
    } catch {
      // 客服/店长考勤拉不到不影响陪玩那张表，静默即可
    } finally {
      setStaffLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    fetchStaffRecords();
  }, [fetchStaffRecords]);

  useEffect(() => {
    http.get('/companions')
      .then(({ data }: any) => setCompanions(data.data ?? []))
      .catch(() => {});
  }, []);

  // 本店把「陪玩考勤」关掉时（老板 2026-10-04：陪玩是提成制、没必要考勤），
  // 这一页就不再列陪玩那张表，只留客服 / 店长的考勤。
  const [companionOn, setCompanionOn] = useState(true);
  useEffect(() => {
    http
      .get('/companions/attendance-today')
      .then(({ data }: any) => setCompanionOn(!!(data?.data?.roles || {}).COMPANION))
      .catch(() => {});
  }, []);

  const columns = useMemo(() => [
    {
      title: '陪玩', key: 'companionName', width: 120,
      render: (_: unknown, r: AttendanceRecord) => r.companionName || '-',
    },
    {
      title: '日期', dataIndex: 'date', key: 'date', width: 120,
      render: (v: string) => v || '-',
    },
    {
      title: '上班', dataIndex: 'checkInTime', key: 'checkInTime', width: 100,
      render: (v: string | null | undefined) => v ? v : '-',
    },
    {
      title: '下班', dataIndex: 'checkOutTime', key: 'checkOutTime', width: 100,
      render: (v: string | null | undefined) => v ? v : '-',
    },
    {
      title: '时长', dataIndex: 'durationHours', key: 'durationHours', width: 80,
      render: (v: number | null | undefined) => v != null ? `${Number(v).toFixed(1)}h` : '-',
    },
    {
      title: '迟到', dataIndex: 'isLate', key: 'isLate', width: 70,
      render: (v: boolean) => v ? <Tag color="orange">是</Tag> : <Tag>否</Tag>,
    },
    {
      title: '早退', dataIndex: 'isEarlyLeave', key: 'isEarlyLeave', width: 70,
      render: (v: boolean) => v ? <Tag color="gold">是</Tag> : <Tag>否</Tag>,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => {
        const cfg = statusConfig[v];
        return cfg ? <Tag color={cfg.color}>{cfg.label}</Tag> : <Tag>{v}</Tag>;
      },
    },
  ], []);

  const staffColumns = useMemo(() => [
    {
      title: '姓名', key: 'name', width: 140,
      render: (_: unknown, r: StaffAttendanceRecord) => r.user?.displayName || r.user?.username || '-',
    },
    {
      title: '职位', key: 'role', width: 90,
      render: (_: unknown, r: StaffAttendanceRecord) => <Tag>{roleLabel(r.user?.role)}</Tag>,
    },
    {
      title: '日期', dataIndex: 'date', key: 'date', width: 120,
      render: (v: string) => (v ? String(v).slice(0, 10) : '-'),
    },
    {
      title: '上班', dataIndex: 'loginAt', key: 'loginAt', width: 100,
      render: (v: string | null | undefined) => hm(v),
    },
    {
      title: '下班', dataIndex: 'logoutAt', key: 'logoutAt', width: 100,
      render: (v: string | null | undefined) => hm(v),
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => {
        const cfg = staffStatusConfig[v];
        return cfg ? <Tag color={cfg.color}>{cfg.label}</Tag> : <Tag>{v}</Tag>;
      },
    },
  ], []);

  const statusOptions = [
    { label: '正常', value: 'NORMAL' },
    { label: '迟到', value: 'LATE' },
    { label: '早退', value: 'EARLY_LEAVE' },
    { label: '缺勤', value: 'ABSENT' },
    { label: '迟到+早退', value: 'LATE_AND_EARLY' },
  ];

  return (
    <div>
      <PageHeader
        title="考勤管理"
        subtitle={
          companionOn
            ? '查看陪玩上下班打卡记录与考勤状态'
            : '本店没开陪玩考勤（陪玩是提成制），这一页只统计客服 / 店长'
        }
        extra={
          <Space>
            <Button icon={createElement(ReloadOutlined)} onClick={fetchRecords} loading={loading}>刷新</Button>
          </Space>
        }
      />

      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        {companionOn && (
          <>
            <RangePicker
          value={dateRange}
          onChange={(dates) => setDateRange(dates as [Dayjs, Dayjs] | null)}
          placeholder={['开始日期', '结束日期']}
          style={{ width: 240 }}
        />
            <Select
              placeholder="选择陪玩"
              allowClear
              style={{ width: 180 }}
              value={companionFilter}
              onChange={setCompanionFilter}
              options={companions.map((c) => ({ label: c.user?.username || c.id, value: c.id }))}
              showSearch
              filterOption={(input, option) => (option?.label as string || '').toLowerCase().includes(input.toLowerCase())}
            />
            <Select
              placeholder="考勤状态"
              allowClear
              style={{ width: 140 }}
              value={statusFilter}
              onChange={setStatusFilter}
              options={statusOptions}
            />
            <Button
              type="primary"
              icon={createElement(SearchOutlined)}
              onClick={fetchRecords}
              loading={loading}
            >
              查询
            </Button>
          </>
        )}
      </div>

      {companionOn && (
        <Table
          columns={columns}
          dataSource={records}
          rowKey="id"
          loading={loading}
          locale={{ emptyText: '暂无考勤记录' }}
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
          onRow={(record) => ({
            style: record.isLate || record.isEarlyLeave ? { background: '#fff1f0' } : undefined,
          })}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '20px 0 12px' }}>
        <div>
          <Text strong style={{ fontSize: 16 }}>🧑‍💼 客服 / 店长考勤</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            客服端 / 店长端上线自动打上班卡、下线打下班卡；管理端手动登记的一律优先，不会被覆盖
          </Text>
        </div>
        <Button icon={createElement(ReloadOutlined)} onClick={fetchStaffRecords} loading={staffLoading}>刷新</Button>
      </div>
      <Table
        columns={staffColumns}
        dataSource={staffRecords}
        rowKey="id"
        loading={staffLoading}
        locale={{ emptyText: '暂无客服 / 店长考勤记录' }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
        onRow={(record) => ({
          style: record.status === 'LATE' || record.status === 'EARLY_LEAVE' || record.status === 'ABSENT'
            ? { background: '#fff1f0' }
            : undefined,
        })}
      />
    </div>
  );
};

export default AttendancePage;
