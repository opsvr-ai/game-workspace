import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Input, Button, Typography, message, Select, Upload, Modal, Checkbox } from 'antd';
import { UserOutlined, LockOutlined, UploadOutlined } from '@ant-design/icons';
import { UserRole } from '@chunlv/shared';
import { useAuthStore } from '../stores/authStore';
import http from '../api/client';
import { reportClientError, diagnoseUploadPath } from '../api/diagnostics';
import { compressImage } from '../utils/imageCompress';
import { restoreClientSession } from '../utils/sessionRestore';

const { Text } = Typography;
const { Option } = Select;

const IconUser = React.createElement(UserOutlined);
const IconLock = React.createElement(LockOutlined);
const CLIENT_VERSION = '1.0.20260854';

const roleRouteMap: Record<UserRole, string> = {
  [UserRole.OWNER]: '/admin',
  [UserRole.ADMIN]: '/admin/dispatch',
  [UserRole.CS]: '/cs/dispatch',
  [UserRole.COMPANION]: '/companion',
};

const LoginPage: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite') || '';
  const [inviteStudioName, setInviteStudioName] = useState('');
  const [inviteUsername, setInviteUsername] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [showInviteLogin, setShowInviteLogin] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // 默认勾上：客户端是「一人一台机器」的接单工具，登录一次就该一直记住；
  // 真要退出账号走的是托盘退出（需要管理密码，会把记住的账号密码一起清掉）。
  const [rememberMe, setRememberMe] = useState(true);
  const [usernameError, setUsernameError] = useState('');
  const didAutoLogin = useRef(false);
  const [forgotVisible, setForgotVisible] = useState(false);
  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotIdNumber, setForgotIdNumber] = useState('');
  const [forgotPassword, setForgotPassword] = useState('');
  const [forgotConfirm, setForgotConfirm] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  // 客户端启动后自动恢复登录：
  // ① 先用主进程里还没过期的令牌直接恢复（不需要密码）；
  // ② 令牌真失效了（超过 7 天 / 主动退出过），再用「记住我」保存的账号密码登录。
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api || didAutoLogin.current) return;
    restoreClientSession()
      .then(async (restored) => {
        if (restored && !didAutoLogin.current) {
          didAutoLogin.current = true;
          // 这里如果 accessToken 已经过期，axios 拦截器会自动用 refreshToken 换新的再重试。
          const restoredUser = await fetchUser();
          if (restoredUser) {
            navigate(roleRouteMap[restoredUser.role] || '/login', { replace: true });
            return;
          }
          // 令牌彻底不认了，交给下面的账号密码兜底
          didAutoLogin.current = false;
        }
        if (!api.getSavedCredentials || didAutoLogin.current) return;
        api.getSavedCredentials().then((creds: any) => {
          if (creds?.username && creds?.password) {
            didAutoLogin.current = true;
            setUsername(creds.username);
            setPassword(creds.password);
            setRememberMe(true);
            performLogin(creds.username, creds.password, true);
          }
        }).catch(() => {});
      })
      .catch(() => {});
  }, []);

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
  const fetchUser = useAuthStore((s) => s.fetchUser);
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
  const [registerAddress, setRegisterAddress] = useState('');
  const [leaseContract, setLeaseContract] = useState<File | null>(null);
  const [skipPhotos, setSkipPhotos] = useState(false);
  const isCompanionRole = registerRole.includes('COMPANION');
  const isAdminRole = registerRole.includes('ADMIN');
  const isOfflineAdmin = registerRole === 'OFFLINE_ADMIN';
  const isOnlineRole = registerRole.startsWith('ONLINE');
  const filteredStudios = studios.filter((s) =>
    isOnlineRole ? s.type === 'RENTAL' : s.type !== 'RENTAL',
  );

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
      .get('/studios/public')
      .then(({ data }) => setStudios(data.data ?? []))
      .catch(() => {});
  }, []);

  const performLogin = async (uname: string, pwd: string, remember: boolean) => {
    if (!uname || !pwd) {
      message.warning('请输入姓名和密码');
      return;
    }
    setLoading(true);
    try {
      const user = await login({ username: uname, password: pwd });
      const api = (window as any).electronAPI;
      if (api?.saveCredentials) {
        try {
          const saved = await api.saveCredentials(
            remember ? { username: uname, password: pwd } : { username: '', password: '' },
          );
          if (remember && saved?.success === false) {
            message.warning('当前系统无法安全保存密码，本次登录不会记住账号密码');
          }
        } catch {
          // 凭据保存失败不影响登录流程
        }
      }
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

  const handleLogin = () => performLogin(username, password, rememberMe);

  const handleForgotPassword = async () => {
    if (!forgotUsername.trim() || !forgotIdNumber.trim() || !forgotPassword || !forgotConfirm) {
      message.warning('请填写账号、身份证号和新密码');
      return;
    }
    if (forgotPassword.length < 6) {
      message.warning('新密码至少6位');
      return;
    }
    if (forgotPassword !== forgotConfirm) {
      message.warning('两次输入的新密码不一致');
      return;
    }
    setForgotLoading(true);
    try {
      await http.post('/auth/forgot-password', {
        username: forgotUsername.trim(),
        idNumber: forgotIdNumber.trim(),
        newPassword: forgotPassword,
      });
      message.success('密码已重置，请用新密码登录');
      setForgotVisible(false);
      setUsername(forgotUsername.trim());
      setPassword('');
    } catch (err: any) {
      message.error(err?.response?.data?.message || '重置失败');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleRegister = async (allowNoPhotos = false) => {
    if (!password || !realName || !idNumber || !phone) {
      message.warning('请填写所有必填字段');
      return;
    }
    if (!registerStudioId) {
      message.warning('请选择工作室');
      return;
    }
    if (isOfflineAdmin && !registerAddress) {
      message.warning('线下工作室店长需要填写地址');
      return;
    }
    if (!allowNoPhotos && (!idCardFront || !idCardBack)) {
      message.warning('注册需要上传身份证正反面照片');
      return;
    }
    // Role mapping: OFFLINE_/ONLINE_ prefix → UserRole
    const roleMap: Record<string, string> = {
      OFFLINE_ADMIN: 'ADMIN', OFFLINE_CS: 'CS', OFFLINE_COMPANION: 'COMPANION',
      ONLINE_ADMIN: 'ADMIN', ONLINE_CS: 'CS', ONLINE_COMPANION: 'COMPANION',
    };
    const apiRole = roleMap[registerRole] || 'COMPANION';

    setLoading(true);
    let photoKb = 0;
    try {
      console.log('注册提交', { realName, phone, apiRole, registerRole, registerStudioId, registerAddress, allowNoPhotos });

      // 手机拍的身份证照片动辄 4~8MB，两张十几兆：弱网上传慢，还容易被安全软件的上网保护
      // 掐断（表现就是「请求根本没到服务器」的 Network Error）。上传前统一压缩到长边 1600。
      let frontFile: File | null = allowNoPhotos ? null : idCardFront;
      let backFile: File | null = allowNoPhotos ? null : idCardBack;
      if (frontFile && backFile) {
        try {
          [frontFile, backFile] = await Promise.all([compressImage(frontFile), compressImage(backFile)]);
        } catch (err: any) {
          reportClientError({
            phase: 'register-photo-read',
            url: '/auth/register',
            message: String(err?.message || err),
            detail: `front=${idCardFront?.name}/${idCardFront?.size}B back=${idCardBack?.name}/${idCardBack?.size}B`,
          });
          Modal.error({
            title: '照片读取失败',
            content: React.createElement(
              'div',
              null,
              React.createElement('div', null, String(err?.message || '身份证照片读取失败')),
              React.createElement('div', { style: { marginTop: 8 } }, '常见原因：① 照片是 iPhone 的 HEIC 等格式，请先转成 JPG 再上传；② 照片是从手机 / 网盘 / 微信临时目录里选的，原文件已经不在了，请先另存到【本机桌面】再选。'),
            ),
          });
          return;
        }
        photoKb = Math.round((frontFile.size + backFile.size) / 1024);
      }

      const buildForm = () => {
        const formData = new FormData();
        formData.append('username', realName);
        formData.append('password', password);
        formData.append('realName', realName);
        formData.append('idNumber', idNumber || '');
        formData.append('phone', phone);
        formData.append('studioId', registerStudioId);
        formData.append('role', apiRole);
        formData.append('registerRole', registerRole); // keep original for studio type detection
        if (isOfflineAdmin && registerAddress) formData.append('address', registerAddress);
        if (isOfflineAdmin && leaseContract) formData.append('leaseContract', leaseContract);
        if (frontFile) formData.append('idCardFront', frontFile);
        if (backFile) formData.append('idCardBack', backFile);
        return formData;
      };

      let res;
      try {
        res = await http.post('/auth/register', buildForm());
      } catch (err: any) {
        // 没有 response = 请求根本没到服务器（断网 / 安全软件拦截 / 路由器掐断），先自动重试一次
        if (err?.response || allowNoPhotos) throw err;
        reportClientError({
          phase: 'register-network-retry',
          url: '/auth/register',
          message: String(err?.message || err),
          detail: `第一次失败，照片合计 ${photoKb}KB，1.5 秒后重试`,
        });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        res = await http.post('/auth/register', buildForm());
      }

      if (res.data?.code === 201) {
        message.success('✅ 注册成功！请等待管理员审核通过后登录', 8);
        setMode('login');
      } else {
        message.error(res.data?.message || '注册失败', 8);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '注册失败，请检查网络';
      const networkLevel = !err?.response;
      let diagnosis: string[] = [];
      if (networkLevel) {
        diagnosis = await diagnoseUploadPath();
        reportClientError({
          phase: allowNoPhotos ? 'register-failed-nophoto' : 'register-failed',
          url: '/auth/register',
          status: null,
          message: msg,
          detail: `${diagnosis.join(' | ')} | 本次照片 ${photoKb}KB`,
        });
      }
      Modal.error({
        title: '注册失败',
        content: React.createElement(
          'div',
          null,
          React.createElement('div', null, msg),
          networkLevel
            ? React.createElement('div', { style: { marginTop: 10, color: '#B45309' } },
                '这次请求根本没到服务器（网络中断，或被这台电脑的安全软件 / 上网保护拦了）。系统已自动重试并做了一轮自检：')
            : null,
          ...diagnosis.map((line, index) =>
            React.createElement('div', { key: index, style: { marginTop: 4, fontSize: 13, color: '#475569' } }, line)),
          networkLevel
            ? React.createElement('div', { style: { marginTop: 10, fontSize: 13, color: '#475569' } },
                '自检里「纯文字请求」通了、带照片那条失败：多半是杀毒软件的上网保护在拦上传 —— 把 1.117.229.36 加进信任，或临时关掉「上网保护」再试一次。照片已经自动压缩过，正常网络下重试一般就能过。')
            : null,
          networkLevel && !allowNoPhotos
            ? React.createElement('div', { style: { marginTop: 10, fontSize: 13, color: '#475569' } },
                '照片一直传不上去：可以点下面的「先不带照片提交」，让店长之后在人员资料里补传照片。')
            : null,
        ),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInviteRegister = async () => {
    if (!inviteStudioName.trim() || !inviteUsername.trim() || !invitePassword) {
      message.warning('请填写工作室名称、登录账号和密码');
      return;
    }
    if (invitePassword.length < 6) {
      message.warning('密码至少6位');
      return;
    }
    setInviteSubmitting(true);
    try {
      const res = await http.post('/studios/register-invite', {
        token: inviteToken,
        studioName: inviteStudioName.trim(),
        username: inviteUsername.trim(),
        password: invitePassword,
      });
      if (res.data?.code === 200) {
        // 开通成功后直接登录，不再让用户停在“下一步怎么登录”的疑惑里
        setInviteSubmitting(false);
        await performLogin(res.data.data.username, invitePassword, true);
        // 登录成功后静默下载最新客户端，并用版本号防浏览器缓存旧包
        setTimeout(() => {
          const a = document.createElement('a');
          a.href = `/api/agent/download/exe?v=${CLIENT_VERSION}`;
          a.download = '陪玩管理-Setup.exe';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }, 800);
        return;
      } else {
        const msg = res.data?.message || '开通失败';
        if (res.data?.code === 409 || msg.includes('已存在') || msg.includes('已有')) {
          setShowInviteLogin(true);
          setUsername(inviteUsername.trim());
          setPassword('');
          message.warning('该登录账号已存在，请直接登录');
        } else {
          message.error(msg);
        }
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '开通失败';
      message.error(msg);
    } finally {
      setInviteSubmitting(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-card" style={{ width: mode === 'register' ? 440 : 400 }}>
        <span className="brand-icon">⚡</span>
        <h1>陪玩管理系统</h1>
        <div className="subtitle">陪玩管理系统 · 前端 v527</div>

        {inviteToken ? (
          showInviteLogin ? (
            <>
              <div style={{ textAlign: 'center', marginBottom: 4 }}>
                <Text strong style={{ fontSize: 16 }}>🔑 直接登录</Text>
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    账号已存在，请输入账号密码登录。
                  </Text>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Input
                  size="large"
                  placeholder="登录账号"
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
                  style={{ height: 46, fontSize: 16, fontWeight: 600, borderRadius: 10, marginTop: 4 }}
                >
                  登 录
                </Button>
                <Button type="link" onClick={() => { setShowInviteLogin(false); setPassword(''); }}>
                  ← 返回工作室开通
                </Button>
              </div>
            </>
          ) : (
            <>
              <div style={{ textAlign: 'center', marginBottom: 4 }}>
                <Text strong style={{ fontSize: 16 }}>🏢 工作室开通</Text>
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    填写你的工作室名称和登录账号密码，提交后即可登录使用。
                  </Text>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Input
                  size="large"
                  placeholder="工作室名称 *"
                  value={inviteStudioName}
                  onChange={(e) => setInviteStudioName(e.target.value)}
                />
                <Input
                  size="large"
                  placeholder="登录账号（店长姓名）*"
                  value={inviteUsername}
                  onChange={(e) => setInviteUsername(e.target.value)}
                />
                <Input.Password
                  size="large"
                  placeholder="密码（至少6位）*"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                />
                <Button
                  type="primary"
                  size="large"
                  block
                  loading={inviteSubmitting}
                  onClick={handleInviteRegister}
                  style={{ height: 46, fontSize: 16, fontWeight: 600, borderRadius: 10, marginTop: 4 }}
                >
                  开通并登录
                </Button>
                <Button type="link" onClick={() => { setShowInviteLogin(true); setUsername(inviteUsername.trim()); }}>
                  已有账号？直接登录
                </Button>
              </div>
            </>
          )
        ) : mode === 'login' ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Input
                size="large"
                placeholder="姓名"
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
              <div style={{ textAlign: 'left', marginTop: 4 }}>
                <Checkbox checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}>
                  记住账号密码
                </Checkbox>
                <Button
                  type="link"
                  onClick={() => {
                    setForgotUsername(username);
                    setForgotIdNumber('');
                    setForgotPassword('');
                    setForgotConfirm('');
                    setForgotVisible(true);
                  }}
                  style={{ float: 'right', padding: 0, fontSize: 13 }}
                >
                  忘记密码？
                </Button>
              </div>
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
              <Input.Password size="large" placeholder="设置密码 *" value={password} onChange={(e) => setPassword(e.target.value)} />
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
              <Select
                size="large"
                placeholder="选择工作室 *"
                value={registerStudioId || undefined}
                onChange={(v) => setRegisterStudioId(v)}
              >
                {filteredStudios.map((s) => (
                  <Option key={s.id} value={s.id}>
                    {s.name} ({s.type === 'RENTAL' ? '线上俱乐部' : '线下工作室'})
                  </Option>
                ))}
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
              {!skipPhotos && (
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    setSkipPhotos(true);
                    void handleRegister(true);
                  }}
                  style={{ color: '#94A3B8', fontSize: 12, padding: 0, height: 20 }}
                >
                  照片一直传不上去？先不带照片提交（店长稍后补传）
                </Button>
              )}
              <Button
                type="primary"
                size="large"
                block
                loading={loading}
                onClick={() => handleRegister()}
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

        <Modal
          title="重置密码"
          open={forgotVisible}
          onCancel={() => setForgotVisible(false)}
          onOk={handleForgotPassword}
          okText="重置密码"
          cancelText="取消"
          confirmLoading={forgotLoading}
          width={360}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            <Input
              placeholder="登录姓名"
              value={forgotUsername}
              onChange={(e) => setForgotUsername(e.target.value)}
            />
            <Input
              placeholder="身份证号"
              value={forgotIdNumber}
              onChange={(e) => setForgotIdNumber(e.target.value)}
              maxLength={18}
            />
            <Input.Password
              placeholder="新密码（至少6位）"
              value={forgotPassword}
              onChange={(e) => setForgotPassword(e.target.value)}
            />
            <Input.Password
              placeholder="再次输入新密码"
              value={forgotConfirm}
              onChange={(e) => setForgotConfirm(e.target.value)}
              onPressEnter={handleForgotPassword}
            />
          </div>
        </Modal>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <a
            href={`/api/agent/download/exe?v=${CLIENT_VERSION}`}
            download
            style={{ color: '#2563EB', fontSize: 13, textDecoration: 'none', fontWeight: 500 }}
          >
            📥 下载 Windows 客户端
          </a>
        </div>
        <div style={{ marginTop: 8, textAlign: 'center' }}>
          <Text style={{ color: '#94A3B8', fontSize: 12 }}>v2.1 · 514ba7c</Text>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
