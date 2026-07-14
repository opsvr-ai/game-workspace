import React, { useState, useEffect, useCallback, createElement, useMemo } from 'react';
import { Table, Tag, Typography, DatePicker, Select, Button, Space, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import http from '../../api/client';
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

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    http.get('/companions')
      .then(({ data }: any) => setCompanions(data.data ?? []))
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

  const statusOptions = [
    { label: '正常', value: 'NORMAL' },
    { label: '迟到', value: 'LATE' },
    { label: '早退', value: 'EARLY_LEAVE' },
    { label: '缺勤', value: 'ABSENT' },
    { label: '迟到+早退', value: 'LATE_AND_EARLY' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <Text strong style={{ fontSize: 16 }}>📋 考勤管理</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>查看陪玩上下班打卡记录与考勤状态</Text>
        </div>
        <Space>
          <Button icon={createElement(ReloadOutlined)} onClick={fetchRecords} loading={loading}>刷新</Button>
        </Space>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
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
      </div>

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
    </div>
  );
};

export default AttendancePage;
