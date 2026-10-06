import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { SEMANTIC } from '../../styles/tokens';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Space,
  Popconfirm,
  Typography,
  InputNumber,
  Image,
  Switch,
} from 'antd';
import { message } from '../../utils/feedback';
import {
  PlusOutlined,
  ReloadOutlined,
  DeleteOutlined,
  KeyOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import { employeesApi } from '../../api/employees';
import { studiosApi } from '../../api/studios';
import { companionsApi } from '../../api/companions';
import { billingApi } from '../../api/billing';
import { useAuthStore } from '../../stores/authStore';
import { UserRole } from '@chunlv/shared';
import { companionStatusConfig } from '../../constants';
import {
  ACTIONS_CELL_CLASS,
  CELL_ONE_LINE,
  CELL_SUB_TEXT,
  TABLE_STYLE,
} from '../../constants/datasetColumns';

const { Text } = Typography;
const { Option } = Select;

const roleLabels: Record<string, { label: string; color: string }> = {
  [UserRole.ADMIN]: { label: '管理员', color: 'blue' },
  [UserRole.CS]: { label: '客服', color: 'green' },
  [UserRole.COMPANION]: { label: '陪玩', color: 'orange' },
};

interface Employee {
  id: string;
  username: string;
  role: string;
  studioId: string;
  isAuthorized: boolean;
  resignedAt?: string | null;
  createdAt: string;
  displayName?: string;
  realName?: string;
  idNumber?: string;
  phone?: string;
  idCardFront?: string;
  idCardBack?: string;
  address?: string;
  leaseContractUrl?: string;
  studio?: { id: string; name: string; type?: string };
  companion?: {
    id: string;
    status: string;
    monthlyRevenue: number;
    games: string[];
    billingCode: string;
    deposit?: number;
    balance?: number;
    frozen?: number;
    realName?: string;
    idNumber?: string;
    phone?: string;
    idCardFront?: string;
    idCardBack?: string;
    isResigned?: boolean;
    isSeniorStaff?: boolean;
  } | null;
}

interface Studio {
  id: string;
  name: string;
}

const EmployeesPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === UserRole.OWNER || user?.role === UserRole.ADMIN;
  const [searchParams] = useSearchParams();
  const urlStudioType = searchParams.get('studioType') || undefined;
  const urlRole = searchParams.get('role') || undefined;
  const pageLabel = useMemo(() => {
    const typeLabel = urlStudioType === 'RENTAL' ? '线上俱乐部' : urlStudioType === 'DIRECT' ? '线下工作室' : '';
    const roleLabel: Record<string, string> = { ADMIN: '店长', CS: '客服', COMPANION: '陪玩' };
    return [typeLabel, urlRole ? roleLabel[urlRole] || '' : ''].filter(Boolean).join(' → ') || '员工管理';
  }, [urlStudioType, urlRole]);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [studios, setStudios] = useState<Studio[]>([]);
  const [selectedStudioId, setSelectedStudioId] = useState<string | undefined>(
    user?.studioId ?? undefined,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detail modal
  const [detailEmployee, setDetailEmployee] = useState<Employee | null>(null);
  // Create modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createForm] = Form.useForm();

  // Reset password modal
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resettingEmployee, setResettingEmployee] = useState<Employee | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetForm] = Form.useForm();

  const [financeModalOpen, setFinanceModalOpen] = useState(false);
  const [financeRecord, setFinanceRecord] = useState<Employee | null>(null);
  const [financeForm] = Form.useForm();
  const [financeSubmitting, setFinanceSubmitting] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [filterRole, setFilterRole] = useState<string | undefined>(urlRole);
  // 已离职的人默认不显示：老板 2026-09-26 反馈「点了离职看着没反应」，就是离职的人还混在在职名单里。
  const [showResigned, setShowResigned] = useState(false);
  // Sync filterRole with URL when switching tabs
  useEffect(() => { setFilterRole(urlRole); setSearchText(''); }, [urlRole]);
  const fetchStudios = useCallback(async () => {
    try {
      const { data } = await studiosApi.list();
      setStudios(data.data ?? []);
    } catch {
      // non-critical, studio names will fall back to ID
    }
  }, []);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await employeesApi.list({ studioId: selectedStudioId, studioType: urlStudioType, role: urlRole });
      setEmployees(data.data ?? []);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '加载员工列表失败';
      setError(msg);
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedStudioId, urlStudioType, urlRole]);

  useEffect(() => {
    fetchStudios();
  }, [fetchStudios]);

  useEffect(() => {
    const timer = setTimeout(() => fetchEmployees(), 300);
    return () => clearTimeout(timer);
  }, [fetchEmployees]);

  const getStudioName = (studioId: string): string => {
    const found = studios.find((s) => s.id === studioId);
    return found?.name ?? studioId;
  };

  // --- Create employee ---
  const openCreateModal = () => {
    createForm.resetFields();
    createForm.setFieldsValue({
      studioId: selectedStudioId,
    });
    setCreateModalOpen(true);
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setSubmitting(true);
      await employeesApi.create(values);
      message.success('员工已创建');
      setCreateModalOpen(false);
      createForm.resetFields();
      fetchEmployees();
    } catch (err: any) {
      if (err?.errorFields) return;
      const msg = err?.response?.data?.message || err?.message || '创建失败';
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // --- Reset password ---
  const openResetModal = (record: Employee) => {
    setResettingEmployee(record);
    resetForm.resetFields();
    setResetModalOpen(true);
  };

  const handleResetPassword = async () => {
    try {
      const values = await resetForm.validateFields();
      if (!resettingEmployee) return;
      setResetting(true);
      await employeesApi.resetPassword(resettingEmployee.id, values.password);
      message.success(`已重置 ${resettingEmployee.username} 的密码`);
      setResetModalOpen(false);
      resetForm.resetFields();
    } catch (err: any) {
      if (err?.errorFields) return;
      const msg = err?.response?.data?.message || err?.message || '重置密码失败';
      message.error(msg);
    } finally {
      setResetting(false);
    }
  };

  const openFinanceModal = async (record: Employee) => {
    setFinanceRecord(record);
    try {
      const { data: overviewRes } = await billingApi.getOverview(record.companion?.id);
      const overview = overviewRes?.data?.summary || {};
      financeForm.setFieldsValue({
        totalRevenue: overview.totalRevenue ?? 0,
        totalWithdrawn: overview.totalWithdrawn ?? 0,
        pendingWithdraw: overview.pendingWithdraw ?? 0,
        todayRevenue: overview.todayRevenue ?? 0,
        withdrawable: overview.withdrawable ?? 0,
        deposit: overview.deposit ?? 0,
        note: "",
      });
    } catch {
      financeForm.setFieldsValue({ totalRevenue: 0, totalWithdrawn: 0, pendingWithdraw: 0, deposit: 0, note: "" });
    }
    setFinanceModalOpen(true);
  };

  const handleFinanceSave = async () => {
    try {
      const values = await financeForm.validateFields();
      if (!financeRecord?.companion?.id) return;
      setFinanceSubmitting(true);
      const { todayRevenue, withdrawable, ...editableFields } = values;
      await companionsApi.updateFinance(financeRecord.companion.id, editableFields);
      message.success(`${financeRecord.username} 财务数据已更新`);
      setFinanceModalOpen(false);
      fetchEmployees();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || "更新失败");
    } finally { setFinanceSubmitting(false); }
  };

  // --- Kick companion ---
  const filteredEmployees = employees.filter((e) => {
    if (searchText && !e.username.toLowerCase().includes(searchText.toLowerCase())) return false;
    if (filterRole && e.role !== filterRole) return false;
    if (!showResigned && e.resignedAt) return false;
    return true;
  });
  // --- Resign companion ---
  const handleResign = async (record: Employee) => {
    try {
      // 陪玩走陪玩那条路（服务端会顺手把客户端踢下线）；客服/店长走统一的员工离职。
      if (record.role === UserRole.COMPANION && record.companion?.id) {
        await companionsApi.resign(record.companion.id);
      } else {
        await employeesApi.resign(record.id);
      }
      message.success(`${record.username} 已办理离职（账号已停用，历史记录保留）`);
      fetchEmployees();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '离职处理失败');
    }
  };

  const handleRestore = async (record: Employee) => {
    try {
      await employeesApi.restore(record.id);
      message.success(`${record.username} 已恢复在职，可以重新登录了`);
      fetchEmployees();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '恢复失败');
    }
  };

  // --- Delete employee ---
  const handleDelete = async (id: string) => {
    try {
      await employeesApi.delete(id);
      message.success('员工已删除');
      fetchEmployees();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '删除失败';
      message.error(msg);
    }
  };

/** 员工表 13 列的宽度之和（= 下面每一列的 width）：写小了 antd 会把列按比例压扁、字被挤成竖排 */
const EMPLOYEE_TABLE_WIDTH = 120 + 76 + 110 + 96 + 80 + 130 + 76 + 88 + 80 + 96 + 84 + 104 + 320;

  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      fixed: 'left' as const,
      // 一格一行（老板 2026-09-28）：名字 + 灰色「已离职」跟在后面，长了自己省略号
      render: (v: string, r: Employee) => (
        <div style={CELL_ONE_LINE} title={r.resignedAt ? `${v} · 已离职` : v}>
          <a onClick={() => setDetailEmployee(r)} style={{ cursor: 'pointer' }}>{v}</a>
          {r.resignedAt && <span style={CELL_SUB_TEXT}>· 已离职</span>}
        </div>
      ),
      key: 'username',
      width: 120,
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 76,
      render: (role: string) => {
        const cfg = roleLabels[role];
        return <Tag color={cfg?.color}>{cfg?.label ?? role}</Tag>;
      },
    },
    {
      title: '工作室',
      dataIndex: 'studioId',
      key: 'studioId',
      width: 110,
      // 一格一行：这一列以前被挤到 20px 宽，「蠢驴电竞」四个字竖着排（老板：很乱）
      render: (studioId: string) => {
        const name = getStudioName(studioId) || '-';
        return <div style={CELL_ONE_LINE} title={name}>{name}</div>;
      },
    },
    {
      title: '机号',
      dataIndex: ['companion', 'billingCode'],
      key: 'billingCode',
      width: 96,
      render: (_: unknown, record: Employee) => record.companion?.billingCode || '-',
    },
    {
      title: '陪玩状态',
      dataIndex: ['companion', 'status'],
      key: 'status',
      width: 80,
      render: (_: unknown, record: Employee) => {
        if (!record.companion) return '-';
        const s = companionStatusConfig[record.companion.status];
        return <Tag color={s?.color}>{s?.label || record.companion.status}</Tag>;
      },
    },
    {
      title: '游戏',
      dataIndex: ['companion', 'games'],
      key: 'games',
      width: 130,
      // 一格一行（以前每个游戏一个彩色小标签，一行放不下就换行，行高忽高忽低）
      render: (_: unknown, record: Employee) => {
        const games = record.companion?.games;
        if (!games || games.length === 0) return '-';
        const names = games.map((g: any) =>
          typeof g === 'string' ? g : g?.game || g?.name || '',
        ).filter(Boolean);
        const text = names.length > 3 ? `${names.slice(0, 3).join(' ')} +${names.length - 3}` : names.join(' ');
        return (
          <div style={CELL_ONE_LINE} title={names.join(' · ')}>
            {text}
          </div>
        );
      },
    },
    {
      title: '今日接单', key: 'todayOrders', width: 76,
      render: (_: unknown, record: any) => <Text strong style={{fontSize:13}}>{record.companion?.todayOrderCount ?? '-'}</Text>,
    },
    {
      title: '总流水',
      dataIndex: ['companion', 'monthlyRevenue'],
      key: 'revenue',
      width: 88,
      render: (_: unknown, record: Employee) =>
        record.companion ? `¥${(record.companion.monthlyRevenue || 0).toLocaleString()}` : '-',
    },
    {
      title: '押金',
      dataIndex: ['companion', 'deposit'],
      key: 'deposit',
      width: 80,
      render: (_: unknown, record: Employee) =>
        record.companion?.deposit !== undefined ? `¥${(record.companion.deposit || 0).toLocaleString()}` : '-',
    },
    {
      title: '可支取余额',
      dataIndex: ['companion', 'balance'],
      key: 'balance',
      width: 96,
      render: (_: unknown, record: Employee) =>
        record.companion?.balance !== undefined ? `¥${(record.companion.balance || 0).toLocaleString()}` : '-',
    },
    {
      title: '审核',
      dataIndex: 'isAuthorized',
      key: 'isAuthorized',
      width: 84,
      render: (isAuthorized: boolean, record: Employee) => {
        if (record.resignedAt) return <Tag color="default">已离职</Tag>;
        return (
          <Tag color={isAuthorized ? 'green' : 'default'}>
            {isAuthorized ? '已授权' : '待审核'}
          </Tag>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 104,
      // 只写「09-28 04:46」（原来写「2026/9/28 04:46:12」要 180px，把别的列挤扁）；完整时间悬停看
      render: (val: string) => {
        if (!val) return '-';
        const d = new Date(val);
        const pad = (n: number) => String(n).padStart(2, '0');
        return (
          <div style={CELL_ONE_LINE} title={d.toLocaleString('zh-CN', { hour12: false })}>
            {`${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`}
          </div>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      // 320 是「重置密码 编辑财务 标记老员工 离职 删除」排一行真正要的宽度，写 228 时删除按钮会被切掉（老板 2026-09-28）
      width: 320,
      fixed: 'right' as const,
      className: ACTIONS_CELL_CLASS,
      render: (_: unknown, record: Employee) => !isAdmin ? <Text type="secondary">-</Text> : (
        <Space size="small">
          <Button type="link" size="small" onClick={() => openResetModal(record)}>
            重置密码
          </Button>
          {record.role === UserRole.COMPANION && record.companion && (
            <Button type="link" size="small" onClick={() => openFinanceModal(record)}>
              编辑财务
            </Button>
          )}
          {record.role === UserRole.COMPANION && record.companion && (
            <Button
              type="link"
              size="small"
              onClick={async () => {
                try {
                  await companionsApi.setSeniorStaff(record.companion!.id, !record.companion!.isSeniorStaff);
                  message.success(record.companion!.isSeniorStaff ? '已取消老员工标记' : '已标记为老员工');
                  fetchEmployees();
                } catch (e: any) {
                  message.error(e?.response?.data?.message || '操作失败');
                }
              }}
            >
              {record.companion.isSeniorStaff ? '取消老员工' : '标记老员工'}
            </Button>
          )}
          {record.role !== UserRole.OWNER && (
            <>
              {record.resignedAt ? (
                <Popconfirm
                  title="确定恢复在职？"
                  description="恢复后可以重新登录。已清零的余额、已释放的工位和工作微信不会自动还原"
                  onConfirm={() => handleRestore(record)}
                  okText="恢复"
                  cancelText="取消"
                >
                  <Button type="link" size="small">恢复在职</Button>
                </Popconfirm>
              ) : (
                <Popconfirm
                  title="确定办理离职？"
                  description="账号停用、无法登录；陪玩还会清空流水/余额并释放工位与工作微信。历史记录保留"
                  onConfirm={() => handleResign(record)}
                  okText="离职"
                  cancelText="取消"
                >
                  <Button type="link" size="small" danger>离职</Button>
                </Popconfirm>
              )}
            </>
          )}
          <Popconfirm
            title="确定删除该员工？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button
            type="link"
              size="small"
              danger
              icon={React.createElement(DeleteOutlined)}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={pageLabel}
        extra={
          <Space>
          {user?.role === UserRole.OWNER && (
          <Select
            placeholder="选择工作室"
            value={selectedStudioId}
            onChange={(val) => setSelectedStudioId(val)}
            style={{ width: 180 }}
            allowClear
            onClear={() => setSelectedStudioId(undefined)}
          >
            {studios.map((s) => (
              <Option key={s.id} value={s.id}>
                {s.name}
              </Option>
            ))}
          </Select>
          )}
              <Select placeholder={`搜索${urlRole === 'CS' ? '客服' : urlRole === 'COMPANION' ? '陪玩' : '员工'}名字`} showSearch value={searchText || undefined} onChange={(v) => setSearchText(v || "")} style={{ width: 190 }} allowClear onClear={() => setSearchText("")} optionFilterProp="children">
                {employees.filter(e => e.role === "COMPANION").map((e) => (
                  <Option key={e.id} value={e.username}>{e.username}</Option>
                ))}
              </Select>
             {!urlRole && (
               <Select placeholder="角色筛选" showSearch optionFilterProp="children" value={filterRole} onChange={(v) => setFilterRole(v)} style={{ width: 120 }} allowClear onClear={() => setFilterRole(undefined)}>
                 <Option value="COMPANION">陪玩</Option>
                 <Option value="ADMIN">管理员</Option>
                 <Option value="CS">客服</Option>
               </Select>
             )}
          <Space size={4}>
            <Switch size="small" checked={showResigned} onChange={setShowResigned} />
            <Text style={{ fontSize: 13 }}>显示已离职</Text>
          </Space>
          <Button
            icon={React.createElement(ReloadOutlined)}
            onClick={fetchEmployees}
            loading={loading}
          >
            刷新
          </Button>
          {isAdmin && (
          <Button
            type="primary"
            icon={React.createElement(PlusOutlined)}
            onClick={openCreateModal}
          >
            新建员工
          </Button>
          )}
          </Space>
        }
      />

      {error && (
        <div
          style={{
            color: SEMANTIC.danger,
            background: SEMANTIC.dangerSoft,
            border: '1px solid ' + SEMANTIC.dangerBorder,
            borderRadius: 6,
            padding: '8px 12px',
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* 老板 2026-09-28：这张表以前没有定宽、也不能横向滚动，13 列被硬挤进一屏，
          「工作室」「今日接单数量」被压到 20px 宽、字竖着排。现在列宽定死，一屏放不下就左右滚
          （用户名钉左边、操作钉右边），每格仍然是一行。 */}
      <Table
        className="data-table"
        size="small"
        columns={columns}
        dataSource={filteredEmployees}
        rowKey="id"
        loading={loading}
        style={TABLE_STYLE}
        scroll={{ x: EMPLOYEE_TABLE_WIDTH }}
        locale={{ emptyText: '暂无员工数据' }}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 名员工`,
        }}
      />

      {/* Create Employee Modal */}
      <Modal
        title="新建员工"
        open={createModalOpen}
        onOk={handleCreate}
        onCancel={() => {
          setCreateModalOpen(false);
          createForm.resetFields();
        }}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select placeholder="请选择角色">
              <Option value={UserRole.ADMIN}>管理员</Option>
              <Option value={UserRole.CS}>客服</Option>
              <Option value={UserRole.COMPANION}>陪玩</Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="studioId"
            label="工作室"
            rules={[{ required: true, message: '请选择工作室' }]}
          >
            <Select placeholder="请选择工作室">
              {studios.map((s) => (
                <Option key={s.id} value={s.id}>
                  {s.name}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        title={`重置密码 — ${resettingEmployee?.username ?? ''}`}
        open={resetModalOpen}
        onOk={handleResetPassword}
        onCancel={() => {
          setResetModalOpen(false);
          resetForm.resetFields();
        }}
        confirmLoading={resetting}
        okText="确定"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={resetForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码至少6位' },
            ]}
          >
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
      {/* Finance Edit Modal */}
      <Modal
        title={`编辑财务数据 — ${financeRecord?.username ?? ""}`}
        open={financeModalOpen}
        onOk={handleFinanceSave}
        onCancel={() => { setFinanceModalOpen(false); financeForm.resetFields(); }}
        confirmLoading={financeSubmitting}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={financeForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="todayRevenue" label="今日流水">
            <InputNumber min={0} step={100} style={{ width: "100%" }} prefix="¥" />
          </Form.Item>
          <Form.Item name="totalRevenue" label="总流水">
            <InputNumber min={0} step={100} style={{ width: "100%" }} prefix="¥" />
          </Form.Item>
          <Form.Item name="totalWithdrawn" label="已支取">
            <InputNumber min={0} step={100} style={{ width: "100%" }} prefix="¥" />
          </Form.Item>
          <Form.Item name="pendingWithdraw" label="审核中">
            <InputNumber min={0} step={100} style={{ width: "100%" }} prefix="¥" />
          </Form.Item>
          <Form.Item name="withdrawable" label="待支取">
            <InputNumber min={0} step={100} style={{ width: "100%" }} prefix="¥" />
          </Form.Item>
          <Form.Item name="deposit" label="押金">
            <InputNumber min={0} step={100} style={{ width: "100%" }} prefix="¥" />
          </Form.Item>
          <Form.Item name="note" label="调整备注">
            <Input placeholder="请输入调整原因" />
          </Form.Item>
        </Form>
      </Modal>
      {/* Detail modal */}
      <Modal title="员工详情" open={!!detailEmployee} onCancel={() => setDetailEmployee(null)} footer={<Button onClick={() => setDetailEmployee(null)}>关闭</Button>} width={520}>
        {detailEmployee && (
          <div style={{lineHeight:2.2}}>
            <p><Text strong>用户名：</Text>{detailEmployee.username}</p>
            <p><Text strong>角色：</Text><Tag color={roleLabels[detailEmployee.role]?.color}>{roleLabels[detailEmployee.role]?.label || detailEmployee.role}</Tag></p>
            <p><Text strong>姓名：</Text>{detailEmployee.realName || detailEmployee.companion?.realName || '-'}</p>
            <p><Text strong>手机号：</Text>{detailEmployee.phone || detailEmployee.companion?.phone || '-'}</p>
            <p><Text strong>身份证号：</Text>{detailEmployee.idNumber || detailEmployee.companion?.idNumber || '-'}</p>
            <p><Text strong>地址：</Text>{detailEmployee.address || '-'}</p>
            <p><Text strong>工作室：</Text>{detailEmployee.studio?.name || '-'}</p>
            {detailEmployee.leaseContractUrl && <p><Text strong>租赁合同：</Text><a href={detailEmployee.leaseContractUrl} target="_blank" rel="noreferrer">查看</a></p>}
            {(detailEmployee.idCardFront || detailEmployee.companion?.idCardFront) && <p><Text strong>身份证正面：</Text><Image src={`/uploads/idcards/${detailEmployee.idCardFront || detailEmployee.companion?.idCardFront}`} width={200} style={{borderRadius:4}} /></p>}
            {(detailEmployee.idCardBack || detailEmployee.companion?.idCardBack) && <p><Text strong>身份证反面：</Text><Image src={`/uploads/idcards/${detailEmployee.idCardBack || detailEmployee.companion?.idCardBack}`} width={200} style={{borderRadius:4}} /></p>}
            <p><Text strong>注册时间：</Text>{detailEmployee.createdAt ? new Date(detailEmployee.createdAt).toLocaleString('zh-CN') : '-'}</p>
          </div>
        )}
      </Modal>
    </div>
  );

};

export default EmployeesPage;
