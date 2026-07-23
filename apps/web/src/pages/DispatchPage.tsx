// craftsman-ignore: TS001,TS002
import React from 'react';
import { Typography } from 'antd';
import { UserRole } from '@chunlv/shared';
import { useAuthStore } from '../stores/authStore';
import CSDispatchView from './dispatch/CSDispatchView';
import PageHeader from '../components/PageHeader';

const { Text } = Typography;

const DispatchPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;

  const getHeaderTitle = () => '派单管理';

  const renderView = () => {
    switch (role) {
      case UserRole.COMPANION:
      case UserRole.CS:
      case UserRole.ADMIN:
      case UserRole.OWNER:
        return <CSDispatchView />;
      default:
        return (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Text type="secondary">无法加载派单页面</Text>
          </div>
        );
    }
  };

  return (
    <div>
      <PageHeader title={getHeaderTitle()} />
      {renderView()}
    </div>
  );
};

export default DispatchPage;
