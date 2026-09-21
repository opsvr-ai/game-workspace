import React, { useEffect, useState } from 'react';
import { Button, Card, Form, Input, message, Select, Table, Typography, DatePicker } from 'antd';
import { payrollApi } from '../../api/payroll';

const { Title, Text } = Typography;

const PayrollPage: React.FC = () => {
  const [staff, setStaff] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(false);
  const [attForm] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        payrollApi.staff(),
        payrollApi.records(month),
      ]);
      setStaff(s.data.data || []);
      setRecords(r.data.data || []);
    } catch {
      message.error('加载工资数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [month]);

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
      setRecords(data.data || []);
      message.success('工资核算完成');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>工资管理</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        工资 = 基本工资 + 提成 − 考勤扣款。提成自动引用「审核 + 支取」里已确认的提成；客服工资在「客服管理 → 客服设置」，店长工资在「店长管理 → 店长设置」。
      </Text>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <Input value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 140 }} placeholder="YYYY-MM" />
        <Button type="primary" onClick={generate} loading={loading}>生成本月工资</Button>
      </div>

      <Card title="考勤登记" size="small" style={{ marginBottom: 16 }}>
        <Form form={attForm} layout="inline" onFinish={markAttendance}>
          <Form.Item name="userId" label="员工" rules={[{ required: true }]}>
            <Select style={{ width: 160 }} options={staff.map((s) => ({ value: s.id, label: s.username }))} />
          </Form.Item>
          <Form.Item name="date" label="日期" rules={[{ required: true }]}><DatePicker /></Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}>
            <Select style={{ width: 120 }} options={[
              { value: 'PRESENT', label: '正常' },
              { value: 'LATE', label: '迟到' },
              { value: 'ABSENT', label: '缺勤' },
            ]} />
          </Form.Item>
          <Button type="primary" htmlType="submit">登记</Button>
        </Form>
      </Card>

      <Card title="工资表" size="small">
        <Table
          rowKey="id"
          loading={loading}
          dataSource={records}
          pagination={{ pageSize: 20 }}
          columns={[
            { title: '姓名', dataIndex: 'username', render: (v: string) => v || '-' },
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
