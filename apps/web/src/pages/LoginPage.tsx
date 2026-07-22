import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button, Typography, message, Select, Upload, Modal } from 'antd';
import { UserOutlined, LockOutlined, UploadOutlined } from '@ant-design/icons';
import { UserRole } from '@chunlv/shared';
import { useAuthStore } from '../stores/authStore';
import http from '../api/client';

const { Text } = Typography;
const { Option } = Select;

const IconUser = React.createElement(UserOutlined);
const IconLock = React.createElement(LockOutlined);

const roleRouteMap: Record<UserRole, string> = {
  [UserRole.OWNER]: '/admin',
  [UserRole.ADMIN]: '/admin/dispatch',
  [UserRole.CS]: '/cs/dispatch',
  [UserRole.COMPANION]: '/companion',
};

const LoginPage: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [usernameError, setUsernameError] = useState('');

  // Check username availability on blur
  const checkUsername = async (val: string) => {
    if (!val || val.length < 2) return;
    try {
      const { data } = await http.get(`/auth/check-username?q=${encodeURIComponent(val)}`);
      if (data?.data?.exists) {
        setUsernameError('该用户名已被注册');
      } else {
        setUsernameError('');
      }
    } catch { /* non-critical */ }
  };
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  // 注册字段
  const [registerRole, setRegisterRole] = useState('OFFLINE_COMPANION'); // 默认线下陪玩
  const [realName, setRealName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [idCardFront, setIdCardFront] = useState<File | null>(null);
  const [idCardBack, setIdCardBack] = useState<File | null>(null);
  const [studios, setStudios] = useState<{ id: string; name: string; type: string }[]>([]);
  const [registerStudioId, setRegisterStudioId] = useState('');
  const [registerStudioName, setRegisterStudioName] = useState('');
  const [registerAddress, setRegisterAddress] = useState('');
  const [leaseContract, setLeaseContract] = useState<File | null>(null);
  const isCompanionRole = registerRole.includes('COMPANION');
  const isAdminRole = registerRole.includes('ADMIN');
  const isOfflineAdmin = registerRole === 'OFFLINE_ADMIN';

  // ID number validation
  const validateIdNumber = (id: string): boolean => {
    if (!/^\d{17}[\dXx]$/.test(id)) return false;
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const checkChars = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
    const sum = id
      .slice(0, 17)
      .split('')
      .reduce((s, d, i) => s + parseInt(d) * weights[i], 0);
    return checkChars[sum % 11] === id[17].toUpperCase();
  };
  const [idNumberError, setIdNumberError] = useState('');
  const handleIdNumberChange = (v: string) => {
    setIdNumber(v);
    if (v.length === 18) {
      if (!validateIdNumber(v)) setIdNumberError('身份证号格式不正确');
      else setIdNumberError('');
    } else if (v.length > 0 && v.length < 18) {
      setIdNumberError('身份证号为18位');
    } else {
      setIdNumberError('');
    }
  };

  useEffect(() => {
    http
      .get('/studios')
      .then(({ data }) => setStudios(data.data ?? []))
      .catch(() => {});
  }, []);

  const handleLogin = async () => {
    if (!username || !password) {
      message.warning('请输入用户名和密码');
      return;
    }
    setLoading(true);
    try {
      const user = await login({ username, password });
      message.success(`欢迎回来，${user.username}`);
      // 陪玩首次登录 → 完善资料
      if (user.role === 'COMPANION') {
        try {
          const { data } = await http.get(`/companions/${user.companionId}`);
          const companion = data.data;
          const games = companion?.games;
          const isEmpty =
            !games || !Array.isArray(games) || games.length === 0 || (games.length > 0 && typeof games[0] === 'string');
          if (isEmpty) {
            navigate('/profile-setup', { replace: true });
            return;
          }
        } catch {}
      }
      navigate(roleRouteMap[user.role] || '/login', { replace: true });
    } catch (err: any) {
      message.error(err?.response?.data?.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!username || !password || !realName || !idNumber || !phone) {
      message.warning('请填写所有必填字段');
      return;
    }
    if (isAdminRole && !registerStudioName) {
      message.warning('请输入工作室名称');
      return;
    }
    if (!isAdminRole && !registerStudioId) {
      message.warning('请选择工作室');
      return;
    }
    if (isOfflineAdmin && !registerAddress) {
      message.warning('线下工作室店长需要填写地址');
      return;
    }
    if (isCompanionRole && (!idCardFront || !idCardBack)) {
      message.warning('陪玩注册需要上传身份证正反面照片');
      return;
    }
    // Role mapping: OFFLINE_/ONLINE_ prefix → UserRole
    const roleMap: Record<string, string> = {
      OFFLINE_ADMIN: 'ADMIN', OFFLINE_CS: 'CS', OFFLINE_COMPANION: 'COMPANION',
      ONLINE_ADMIN: 'ADMIN', ONLINE_CS: 'CS', ONLINE_COMPANION: 'COMPANION',
    };
    const apiRole = roleMap[registerRole] || 'COMPANION';

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('username', username);
      formData.append('password', password);
      formData.append('realName', realName);
      formData.append('idNumber', idNumber || '');
      formData.append('phone', phone);
      formData.append('studioId', isAdminRole ? '' : registerStudioId);
      if (isAdminRole) formData.append('studioName', registerStudioName);
      formData.append('role', apiRole);
      if (isOfflineAdmin && registerAddress) formData.append('address', registerAddress);
      if (isOfflineAdmin && leaseContract) formData.append('leaseContract', leaseContract);
      if (idCardFront) formData.append('idCardFront', idCardFront);
      if (idCardBack) formData.append('idCardBack', idCardBack);

      const res = await http.post('/auth/register', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data?.code === 201) {
        message.success('✅ 注册成功！请等待管理员审核通过后登录', 8);
        setMode('login');
      } else {
        message.error(res.data?.message || '注册失败', 8);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '注册失败，请检查网络';
      Modal.error({ title: '注册失败', content: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-card" style={{ width: mode === 'register' ? 440 : 400 }}>
        <span className="brand-icon">⚡</span>
        <h1>蠢驴电竞</h1>
        <div className="subtitle">CHUNLV ESPORTS · 陪玩派单管理系统</div>

        {mode === 'login' ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Input
                size="large"
                placeholder="用户名"
                prefix={IconUser}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onPressEnter={handleLogin}
              />
              <Input.Password
                size="large"
                placeholder="密码"
                prefix={IconLock}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onPressEnter={handleLogin}
              />
              <Button
                type="primary"
                size="large"
                block
                loading={loading}
                onClick={handleLogin}
                style={{
                  height: 46,
                  fontSize: 16,
                  fontWeight: 600,
                  borderRadius: 10,
                  marginTop: 4,
                  background: 'var(--color-gradient-brand)',
                  border: 'none',
                  color: '#FFF',
                  boxShadow: '0 2px 8px rgba(123,97,255,0.3)',
                }}
              >
                登 录
              </Button>
            </div>
            <div style={{ marginTop: 16, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Button type="link" onClick={() => { setMode('register'); setUsername(''); setPassword(''); }} style={{ color: '#2563EB', fontSize: 13 }}>
                注册新账号 →
              </Button>
              <Text style={{ color: '#94A3B8', fontSize: 11 }}>工作室店长 / 客服 / 陪玩均可注册</Text>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 380, overflowY: 'auto' }}>
              <Input
                size="large"
                placeholder="用户名 *"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setUsernameError(''); }}
                onBlur={(e) => checkUsername(e.target.value)}
                status={usernameError ? 'error' : undefined}
              />
              {usernameError && <Text type="danger" style={{ fontSize: 12 }}>{usernameError}</Text>}
              <Input.Password
                size="large"
                placeholder="密码 *"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Input
                size="large"
                placeholder="真实姓名 *"
                value={realName}
                onChange={(e) => setRealName(e.target.value)}
                onBlur={() => {
                  if (realName && !/^[\u4e00-\u9fa5]{2,4}$/.test(realName)) message.warning('姓名应为2-4个中文字符');
                }}
              />
              <Input
                size="large"
                placeholder="身份证号 *"
                value={idNumber}
                onChange={(e) => handleIdNumberChange(e.target.value)}
                status={idNumberError ? 'error' : undefined}
              />
              <div style={{ color: '#FF4757', fontSize: 12, marginTop: -8, marginBottom: 8, textAlign: 'left' }}>
                {idNumberError || '\u00A0'}
              </div>
              <Input size="large" placeholder="手机号 *" value={phone} onChange={(e) => setPhone(e.target.value)} />
              {isAdminRole ? (
                <Input
                  size="large"
                  placeholder="工作室名称 *"
                  value={registerStudioName}
                  onChange={(e) => setRegisterStudioName(e.target.value)}
                />
              ) : (
                <Select
                  size="large"
                  placeholder="选择工作室 *"
                  value={registerStudioId || undefined}
                  onChange={(v) => setRegisterStudioId(v)}
                >
                  {studios.map((s) => (
                    <Option key={s.id} value={s.id}>
                      {s.name} ({s.type === 'RENTAL' ? '线上俱乐部' : '线下工作室'})
                    </Option>
                  ))}
                </Select>
              )}
              <Select
                size="large"
                placeholder="选择注册角色 *"
                value={registerRole}
                onChange={(v) => setRegisterRole(v)}
              >
                <Option value="OFFLINE_ADMIN">🏢 线下工作室 · 店长</Option>
                <Option value="OFFLINE_CS">🏢 线下工作室 · 客服</Option>
                <Option value="OFFLINE_COMPANION">🏢 线下工作室 · 陪玩</Option>
                <Option value="ONLINE_ADMIN">🌐 线上俱乐部 · 店长</Option>
                <Option value="ONLINE_CS">🌐 线上俱乐部 · 客服</Option>
                <Option value="ONLINE_COMPANION">🌐 线上俱乐部 · 陪玩</Option>
              </Select>
              {isOfflineAdmin && (
                <>
                  <Input
                    size="large"
                    placeholder="工作室地址 *"
                    value={registerAddress}
                    onChange={(e) => setRegisterAddress(e.target.value)}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Upload
                      beforeUpload={(f) => { setLeaseContract(f); return false; }}
                      maxCount={1}
                      accept="image/*"
                    >
                      <Button icon={React.createElement(UploadOutlined)}>
                        {leaseContract ? '✓ 合同已选' : '租赁合同照片'}
                      </Button>
                    </Upload>
                    <Text style={{ color: '#94A3B8', fontSize: 11 }}>选填</Text>
                  </div>
                </>
              )}
              {isCompanionRole && (
              <div style={{ display: 'flex', gap: 12 }}>
                <Upload
                  beforeUpload={(f) => {
                    setIdCardFront(f);
                    return false;
                  }}
                  maxCount={1}
                  accept="image/*"
                >
                  <Button icon={React.createElement(UploadOutlined)}>
                    {idCardFront ? '✓ 正面已选' : '身份证正面 *'}
                  </Button>
                </Upload>
                <Upload
                  beforeUpload={(f) => {
                    setIdCardBack(f);
                    return false;
                  }}
                  maxCount={1}
                  accept="image/*"
                >
                  <Button icon={React.createElement(UploadOutlined)}>
                    {idCardBack ? '✓ 反面已选' : '身份证反面 *'}
                  </Button>
                </Upload>
              </div>
              )}
              <Button
                type="primary"
                size="large"
                block
                loading={loading}
                onClick={handleRegister}
                style={{
                  height: 46,
                  fontSize: 16,
                  fontWeight: 600,
                  borderRadius: 10,
                  marginTop: 4,
                  background: 'var(--color-gradient-brand)',
                  border: 'none',
                  color: '#FFF',
                }}
              >
                提交注册
              </Button>
            </div>
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <Button type="link" onClick={() => setMode('login')} style={{ color: '#94A3B8', fontSize: 13 }}>
                ← 返回登录
              </Button>
            </div>
          </>
        )}

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <a
            href="/api/download/agent"
            download
            style={{ color: '#2563EB', fontSize: 13, textDecoration: 'none', fontWeight: 500 }}
          >
            📥 下载 Windows 客户端
          </a>
        </div>
        <div style={{ marginTop: 8, textAlign: 'center' }}>
          <Text style={{ color: '#94A3B8', fontSize: 12 }}>v2.1 · 面向电竞陪玩工作室</Text>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
