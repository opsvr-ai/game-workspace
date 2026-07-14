import React, { useState } from 'react';
import { Card, Form, Input, Button, Typography, Upload, message } from 'antd';
import { UserOutlined, LockOutlined, CameraOutlined } from '@ant-design/icons';
import { authApi } from '../api/client';

const { Text, Title } = Typography;

const ProfilePage: React.FC = () => {
  const [pwdLoading, setPwdLoading] = useState(false);
  const [nameLoading, setNameLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [pwdForm] = Form.useForm();
  const [nameForm] = Form.useForm();

  const userStr = sessionStorage.getItem('user');
  const user = userStr ? JSON.parse(userStr) : null;
  const avatarUrl = user?.avatar
    ? `/uploads/avatars/${user.avatar}`
    : null;

  const reloadUser = async () => {
    const { data: meData } = await authApi.me();
    sessionStorage.setItem('user', JSON.stringify(meData.data));
    window.location.reload();
  };

  const handleChangePassword = async () => {
    try {
      const values = await pwdForm.validateFields();
      setPwdLoading(true);
      await authApi.changePassword(values.oldPassword, values.newPassword);
      message.success('密码已修改，下次登录请使用新密码');
      pwdForm.resetFields();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || '修改失败');
    } finally {
      setPwdLoading(false);
    }
  };

  const handleUpdateName = async () => {
    try {
      const values = await nameForm.validateFields();
      setNameLoading(true);
      await authApi.updateProfile(values.displayName || '');
      message.success('名字已更新');
      await reloadUser();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || '更新失败');
    } finally {
      setNameLoading(false);
    }
  };

  const beforeUpload = async (file: File) => {
    const isImage = file.type.match(/^image\/(jpeg|png|webp)$/);
    if (!isImage) { message.error('仅支持 JPG/PNG/WEBP 格式'); return false; }
    if (file.size / 1024 / 1024 > 2) { message.error('图片不能超过 2MB'); return false; }
    setAvatarLoading(true);
    try {
      await authApi.uploadAvatar(file);
      message.success('头像已更新');
      await reloadUser();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '上传失败');
    } finally {
      setAvatarLoading(false);
    }
    return false;
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 16 }}>个人设置</Title>

      {/* Avatar Card */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: avatarUrl ? `url(${avatarUrl}) center/cover` : '#1677ff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {!avatarUrl && (
              <Text style={{ color: '#fff', fontSize: 28, fontWeight: 700 }}>
                {(user?.displayName || user?.username || '?')[0].toUpperCase()}
              </Text>
            )}
          </div>
          <div>
            <Text strong style={{ fontSize: 16 }}>
              {user?.displayName || user?.username || '未知用户'}
            </Text>
            <div style={{ marginTop: 4 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                @{user?.username} · {user?.role}
              </Text>
            </div>
            <Upload showUploadList={false} beforeUpload={beforeUpload} accept="image/jpeg,image/png,image/webp">
              <Button size="small" icon={React.createElement(CameraOutlined)} loading={avatarLoading} style={{ marginTop: 8 }}>
                更换头像
              </Button>
            </Upload>
          </div>
        </div>
      </Card>

      {/* Display Name Card */}
      <Card size="small" title="修改名字" style={{ marginBottom: 12 }}>
        <Form form={nameForm} layout="vertical" initialValues={{ displayName: user?.displayName || '' }}>
          <Form.Item name="displayName" label="显示名字" rules={[{ required: true, message: '请输入显示名字' }]}>
            <Input placeholder="输入你的显示名字" prefix={React.createElement(UserOutlined)} />
          </Form.Item>
          <Button type="primary" loading={nameLoading} onClick={handleUpdateName}>保存名字</Button>
        </Form>
      </Card>

      {/* Password Card */}
      <Card size="small" title="修改密码">
        <Form form={pwdForm} layout="vertical">
          <Form.Item name="oldPassword" label="旧密码" rules={[{ required: true, message: '请输入旧密码' }]}>
            <Input.Password placeholder="输入当前密码" prefix={React.createElement(LockOutlined)} />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '密码至少6位' }]}>
            <Input.Password placeholder="输入新密码（至少6位）" prefix={React.createElement(LockOutlined)} />
          </Form.Item>
          <Form.Item name="confirmPassword" label="确认新密码" dependencies={['newPassword']}
            rules={[{ required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error('两次密码不一致'));
                },
              }),
            ]}>
            <Input.Password placeholder="再次输入新密码" prefix={React.createElement(LockOutlined)} />
          </Form.Item>
          <Button type="primary" loading={pwdLoading} onClick={handleChangePassword}>修改密码</Button>
        </Form>
      </Card>
    </div>
  );
};

export default ProfilePage;
