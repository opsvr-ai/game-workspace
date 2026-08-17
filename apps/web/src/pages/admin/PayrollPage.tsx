import React, { useEffect, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, message, Select, Table, Typography, DatePicker } from 'antd';
import { payrollApi } from '../../api/payroll';

const { Title, Text } = Typography;

const PayrollPage: React.FC = () => {
  const [configs, setConfigs] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const [attForm] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const [c, s, r] = await Promise.all([
        payrollApi.configs(),
        payrollApi.staff(),
        payrollApi.records(month),
      ]);
      setConfigs(c.data.data || []);
      setStaff(s.data.data || []);
      setRecords(r.data.data || []);
    } catch {
      message.error('加载工资数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [month]);

  const saveConfig = async (values: any) => {
    await payrollApi.saveConfig(values);
    message.success('工资规则已保存');
    load();
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
      setRecords(data.data || []);
      message.success('工资核算完成');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>工资管理</Title>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <Input value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 140 }} placeholder="YYYY-MM" />
        <Button type="primary" onClick={generate} loading={loading}>生成本月工资</Button>
      </div>

      <Card title="工资规则" size="small" style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" onFinish={saveConfig}>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select style={{ width: 120 }} options={[{ value: 'CS', label: '客服' }, { value: 'ADMIN', label: '店长' }]} />
          </Form.Item>
          <Form.Item name="baseSalary" label="基本工资" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item>
          <Form.Item name="performancePercent" label="绩效比例%" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item>
          <Form.Item name="offlinePercent" label="线下流水提成%" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item>
          <Form.Item name="bridgeFixed" label="桥接固定提成" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item>
          <Form.Item name="fullAttendanceDays" label="满勤天数" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item>
          <Form.Item name="lateDeduction" label="迟到扣款" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item>
          <Form.Item name="absentDeduction" label="缺勤扣款" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item>
          <Button type="primary" htmlType="submit">保存规则</Button>
        </Form>
      </Card>

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
            { title: '用户ID', dataIndex: 'userId' },
            { title: '月份', dataIndex: 'month' },
            { title: '基本工资', dataIndex: 'baseSalary' },
            { title: '绩效工资', dataIndex: 'performanceSalary' },
            { title: '考勤扣款', dataIndex: 'attendanceDeduction' },
            { title: '应发工资', dataIndex: 'totalSalary' },
            { title: '状态', dataIndex: 'status' },
          ]}
        />
      </Card>
    </div>
  );
};

export default PayrollPage;
