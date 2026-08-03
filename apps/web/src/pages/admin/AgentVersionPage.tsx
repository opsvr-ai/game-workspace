import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Tag,
  Space,
  Typography,
  message,
  Popconfirm,
  Spin,
  Statistic,
  Row,
  Col,
  Modal,
  Tooltip,
  Input,
  Divider,
  Alert,
} from 'antd';
import {
  ReloadOutlined,
  CloudUploadOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  SendOutlined,
  CopyOutlined,
  LaptopOutlined,
  ThunderboltOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { agentApi } from '../../api/agent';

const { Text, Title, Paragraph } = Typography;

interface CompanionVersion {
  companionId: string;
  name: string;
  status: string;
  agentVersion: string;
  lastHeartbeat: string | null;
  isLatest: boolean;
}

interface VersionStatus {
  latestVersion: string;
  onlineCount: number;
  upToDateCount: number;
  pendingCount: number;
  list: CompanionVersion[];
}

interface DeployScriptData {
  script: string;
  downloadUrl: string;
  serverUrl: string;
}

const statusColors: Record<string, string> = {
  AVAILABLE: 'green',
  BUSY: 'red',
  ENTERTAINMENT: 'gold',
  RESTING: 'orange',
  OFFLINE: 'default',
  ONLINE: 'blue',
};

const statusLabels: Record<string, string> = {
  AVAILABLE: '空闲',
  BUSY: '接单中',
  ENTERTAINMENT: '娱乐',
  RESTING: '休息',
  OFFLINE: '离线',
  ONLINE: '在线',
};

const AgentVersionPage: React.FC = () => {
  const [versionStatus, setVersionStatus] = useState<VersionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [deployData, setDeployData] = useState<DeployScriptData | null>(null);
  const [copied, setCopied] = useState(false);

  // Remote deploy form state
  const [remoteIPs, setRemoteIPs] = useState('');
  const [remoteUser, setRemoteUser] = useState('Administrator');
  const [remotePass, setRemotePass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [remoteScript, setRemoteScript] = useState<string | null>(null);
  const [generatingRemote, setGeneratingRemote] = useState(false);
  const [remoteCopied, setRemoteCopied] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployOutput, setDeployOutput] = useState<string | null>(null);
  const [scannedIPs, setScannedIPs] = useState<{ip:string;mac?:string}[]>([]);

  // Detect Electron environment
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await agentApi.getVersionStatus();
      setVersionStatus(data.data as VersionStatus);
    } catch {
      message.error('加载版本状态失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleBuildAndPush = async () => {
    setBuilding(true);
    try {
      const { data } = await agentApi.buildAndPush();
      if (data.code === 200) {
        message.success(data.message || '构建成功，已推送');
        fetchStatus();
      } else {
        message.error(data.data?.output || data.message || '构建失败');
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      message.error(e?.response?.data?.message || '构建请求失败');
    } finally {
      setBuilding(false);
    }
  };

  const handlePushSelected = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择陪玩');
      return;
    }
    setPushing(true);
    try {
      const { data } = await agentApi.pushUpdate(selectedRowKeys as string[]);
      if (data.code === 200) {
        message.success(data.message);
        setSelectedRowKeys([]);
      } else {
        message.error(data.message || '推送失败');
      }
    } catch {
      message.error('推送请求失败');
    } finally {
      setPushing(false);
    }
  };

  const handlePushAll = async () => {
    setPushing(true);
    try {
      const { data } = await agentApi.pushUpdateStudio();
      if (data.code === 200) {
        message.success(data.message);
      } else {
        message.error(data.message || '全量推送失败');
      }
    } catch {
      message.error('全量推送请求失败');
    } finally {
      setPushing(false);
    }
  };

  const handleOpenDeploy = async () => {
    setDeployModalOpen(true);
    try {
      const { data } = await agentApi.getDeployScript();
      if (data.code === 200) {
        setDeployData(data.data as DeployScriptData);
      }
    } catch {
      message.error('获取部署脚本失败');
    }
  };

  const handleCopyScript = () => {
    if (deployData?.script) {
      navigator.clipboard
        .writeText(deployData.script)
        .then(() => {
          setCopied(true);
          message.success('已复制到剪贴板');
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {
          message.error('复制失败，请手动复制');
        });
    }
  };

  const handleGenerateRemote = async () => {
    const ips = remoteIPs
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ips.length === 0) {
      message.warning('请输入目标电脑 IP');
      return;
    }
    if (!remoteUser) {
      message.warning('请输入管理员账号');
      return;
    }
    setGeneratingRemote(true);
    setRemoteScript(null);
    try {
      const { data } = await agentApi.getRemoteDeployScript({
        targetIPs: ips,
        adminUser: remoteUser,
        adminPass: remotePass,
      });
      if (data.code === 200) {
        setRemoteScript((data.data as { script: string }).script);
      } else {
        message.error(data.message || '生成失败');
      }
    } catch {
      message.error('生成脚本失败');
    } finally {
      setGeneratingRemote(false);
    }
  };

  const handleCopyRemote = () => {
    if (remoteScript) {
      navigator.clipboard
        .writeText(remoteScript)
        .then(() => {
          setRemoteCopied(true);
          message.success('脚本已复制到剪贴板');
          setTimeout(() => setRemoteCopied(false), 2000);
        })
        .catch(() => {
          message.error('复制失败');
        });
    }
  };

  const handleElectronDeploy = async () => {
    if (!remoteScript || !isElectron) return;
    setDeploying(true);
    setDeployOutput(null);
    try {
      const api = (window as any).electronAPI;
      const result = await api.executeRemoteDeploy(remoteScript);
      setDeployOutput(result.output || (result.success ? '部署完成' : '部署失败'));
      if (result.success) {
        message.success('远程批量部署完成！');
      } else {
        message.warning('部署完成，部分可能失败，请检查输出');
      }
    } catch (err: any) {
      setDeployOutput(err?.message || '执行失败');
      message.error('部署执行失败');
    } finally {
      setDeploying(false);
    }
  };

  const columns = [
    {
      title: '陪玩',
      dataIndex: 'name',
      key: 'name',
      width: 140,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: string) => <Tag color={statusColors[s] || 'default'}>{statusLabels[s] || s}</Tag>,
    },
    {
      title: '当前版本',
      dataIndex: 'agentVersion',
      key: 'agentVersion',
      width: 100,
    },
    {
      title: '版本状态',
      key: 'versionStatus',
      width: 100,
      render: (_: unknown, r: CompanionVersion) =>
        r.isLatest ? (
          <Tag color="green" icon={<CheckCircleOutlined />}>
            最新
          </Tag>
        ) : (
          <Tag color="orange" icon={<SyncOutlined />}>
            待更新
          </Tag>
        ),
    },
    {
      title: '最后心跳',
      dataIndex: 'lastHeartbeat',
      key: 'lastHeartbeat',
      width: 160,
      render: (hb: string | null) => {
        if (!hb) return <Text type="secondary">-</Text>;
        const dt = new Date(hb);
        const diff = Date.now() - dt.getTime();
        const online = diff < 120000;
        return (
          <Space size={4}>
            <span style={{ color: online ? '#52c41a' : '#d9d9d9', fontSize: 12 }}>●</span>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {dt.toLocaleString('zh-CN')}
            </Text>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            版本管理
          </Title>
          <Text type="secondary">管理陪玩客户端版本，一键构建并推送更新</Text>
        </div>
        <Space>
          <Tooltip title="查看新电脑部署脚本">
            <Button icon={<LaptopOutlined />} onClick={handleOpenDeploy}>
              部署助手
            </Button>
          </Tooltip>
          <Button icon={<ReloadOutlined />} onClick={fetchStatus} loading={loading}>
            刷新
          </Button>
          <Popconfirm
            title="确认全量推送？"
            description="将立即向本工作室所有在线陪玩推送更新命令"
            onConfirm={handlePushAll}
            okText="确认"
            cancelText="取消"
          >
            <Button icon={<SendOutlined />} loading={pushing}>
              全量推送
            </Button>
          </Popconfirm>
          <Popconfirm
            title="确认构建并推送？"
            description="将执行 git pull + 构建，完成后自动推送到所有在线陪玩"
            onConfirm={handleBuildAndPush}
            okText="确认"
            cancelText="取消"
          >
            <Button type="primary" icon={<CloudUploadOutlined />} loading={building}>
              构建并推送
            </Button>
          </Popconfirm>
        </Space>
      </div>

      {/* Stat Cards */}
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="最新版本" value={versionStatus?.latestVersion || '-'} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="在线陪玩" value={versionStatus?.onlineCount || 0} suffix="人" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="已是最新"
              value={versionStatus?.upToDateCount || 0}
              valueStyle={{ color: '#52c41a' }}
              suffix="人"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="待更新"
              value={versionStatus?.pendingCount || 0}
              valueStyle={{ color: '#faad14' }}
              suffix="人"
            />
          </Card>
        </Col>
      </Row>

      {/* Selection toolbar */}
      {selectedRowKeys.length > 0 && (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 16px',
            background: '#e6f4ff',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text>
            已选择 <Text strong>{selectedRowKeys.length}</Text> 位陪玩
          </Text>
          <Space>
            <Button size="small" onClick={() => setSelectedRowKeys([])}>
              取消选择
            </Button>
            <Popconfirm
              title={`确认推送更新？`}
              description={`将向选中的 ${selectedRowKeys.length} 位陪玩发送更新命令`}
              onConfirm={handlePushSelected}
              okText="确认"
              cancelText="取消"
            >
              <Button type="primary" size="small" icon={<SendOutlined />} loading={pushing}>
                推送更新 ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          </Space>
        </div>
      )}

      {/* Version Table */}
      <Card title="陪玩版本分布" extra={<Text type="secondary">共 {versionStatus?.list?.length || 0} 条记录</Text>}>
        <Table
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
            getCheckboxProps: (record: CompanionVersion) => ({
              disabled: record.isLatest,
            }),
          }}
          columns={columns}
          dataSource={versionStatus?.list || []}
          rowKey="companionId"
          loading={loading}
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 位陪玩` }}
          locale={{ emptyText: '暂无数据' }}
        />
      </Card>

      {/* Deploy Assistant Modal */}
      <Modal
        title={
          <>
            <LaptopOutlined /> 部署助手 — 新电脑安装客户端
          </>
        }
        open={deployModalOpen}
        onCancel={() => {
          setDeployModalOpen(false);
          setRemoteScript(null);
          setRemotePass('');
        }}
        width={720}
        footer={[
          <Button
            key="close"
            onClick={() => {
              setDeployModalOpen(false);
              setRemoteScript(null);
              setRemotePass('');
            }}
          >
            关闭
          </Button>,
        ]}
      >
        <Spin spinning={!deployData}>
          {deployData && (
            <>
              <Card size="small" style={{ background: '#fff7e6' }}>
                <Text strong style={{ fontSize: 15 }}>⚡ PsExec 远程批量部署</Text>
                <div style={{ marginTop: 8 }}>
                  <Space><Button size="small" loading={generatingRemote} onClick={async () => {
                    setGeneratingRemote(true);
                    try { const res = await agentApi.scanLan(); const list = (res.data as any).data || []; setScannedIPs(list); setRemoteIPs(list.map((h: any) => h.ip).join('\n')); message.success('发现 ' + list.length + ' 台设备'); } catch { message.error('扫描失败'); }
                    setGeneratingRemote(false);
                  }}>📡 扫描局域网</Button></Space>
                  {scannedIPs.length > 0 && (
                    <div style={{ marginTop: 8, maxHeight: 200, overflow: 'auto' }}>
                      {scannedIPs.map(h => (
                        <div key={h.ip} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}>
                          <span><Text code>{h.ip}</Text>{h.mac ? <Text type="secondary" style={{ fontSize: 10, marginLeft: 8 }}>{h.mac}</Text> : null}</span>
                          <Button size="small" type="primary" onClick={() => {
                            const cmd = 'psexec \\\\' + h.ip + ' -s powershell -Command "Invoke-WebRequest http://' + (deployData?.serverUrl?.replace(/https?:\/\//,'') || '192.168.0.106') + ':3001/uploads/蠢驴电竞.zip -OutFile $env:TEMP\\c.zip; Expand-Archive $env:TEMP\\c.zip -DestinationPath $env:TEMP\\c -Force; Start-Process $env:TEMP\\c\\蠢驴电竞.exe"';
                            navigator.clipboard.writeText(cmd).then(() => message.success('已复制安装命令'));
                          }}>📋 复制命令</Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <Input.TextArea rows={3} style={{ marginTop: 4 }} value={remoteIPs} onChange={e => setRemoteIPs(e.target.value)} placeholder="192.168.1.10&#10;192.168.1.11" />
                  <Row gutter={8} style={{ marginTop: 4 }}>
                    <Col span={8}><Input placeholder="管理员账号" value={remoteUser} onChange={e => setRemoteUser(e.target.value)} /></Col>
                    <Col span={8}><Input.Password placeholder="管理员密码" value={remotePass} onChange={e => setRemotePass(e.target.value)} /></Col>
                    <Col span={8}><Button type="primary" loading={generatingRemote} onClick={handleGenerateRemote} block>生成脚本</Button></Col>
                  </Row>
                  {remoteScript && <pre style={{ background:'#1e1e1e',color:'#d4d4d4',padding:10,borderRadius:6,fontSize:11,whiteSpace:'pre-wrap',maxHeight:300,overflow:'auto',marginTop:8 }}>{remoteScript}</pre>}
                  <Button danger type="primary" loading={deploying} style={{ marginTop: 8 }} block onClick={async () => {
                    if (!remoteIPs.trim()) { message.warning('请先扫描或输入IP'); return; }
                    setDeploying(true);
                    try {
                      const res = await agentApi.getRemoteDeployScript({ targetIPs: remoteIPs.split(/[\n,]+/).filter(Boolean), adminUser: remoteUser || 'Administrator', adminPass: remotePass || '' });
                      const script = (res.data as any).data?.script;
                      if (!script) { message.error('生成失败'); setDeploying(false); return; }
                      const ea = (window as any).electronAPI;
                      if (ea?.executeRemoteDeploy) {
                        const r = await ea.executeRemoteDeploy(script);
                        message.success(r.success ? '全部安装完成！' : '部分失败，查看输出');
                        setDeployOutput(r.output);
                      } else {
                        navigator.clipboard.writeText(script).then(() => message.success('已复制脚本，粘贴到PowerShell执行'));
                      }
                    } catch { message.error('执行失败'); }
                    setDeploying(false);
                  }}>⚡ 一键全部安装</Button>
                  {deployOutput && <pre style={{ background:'#1e1e1e',color:'#d4d4d4',padding:10,borderRadius:6,fontSize:11,whiteSpace:'pre-wrap',maxHeight:200,overflow:'auto',marginTop:8 }}>{deployOutput}</pre>}
                </div>
              </Card>
              <div style={{ marginTop: 12 }}>
                <Text type="secondary">💡 服务器地址：{deployData.serverUrl}</Text>
              </div>
            </>
          )}
        </Spin>
      </Modal>
    </div>
  );
};

export default AgentVersionPage;
