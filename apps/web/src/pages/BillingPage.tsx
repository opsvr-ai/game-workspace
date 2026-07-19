// craftsman-ignore: TS001,TS002
import React from 'react';
import { Tabs } from 'antd';
import { UserRole } from '@chunlv/shared';
import { useAuthStore } from '../stores/authStore';
import CompanionBillingView from './billing/CompanionBillingView';
import TransactionList from './billing/TransactionList';
import ExpenseApproval from './billing/ExpenseApproval';
import SettlementPanel from './billing/SettlementPanel';
import OverviewPanel from './billing/OverviewPanel';
import PageHeader from '../components/PageHeader';

const BillingPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === UserRole.OWNER || user?.role === UserRole.ADMIN;

  if (!isAdmin) {
    return <CompanionBillingView />;
  }

  const tabItems = [
    { key: 'transactions', label: '报账审核', children: <TransactionList /> },
    { key: 'expenses', label: '报账与财务', children: <ExpenseApproval /> },
    { key: 'settlement', label: '月底结算', children: <SettlementPanel /> },
    { key: 'wallet', label: '钱包审核', children: <OverviewPanel /> },
  ];

  return (
    <div>
      <PageHeader title="报账系统" />
      {/* Always show companion view section for admin users who also have a companionId */}
      {user?.companionId && <CompanionBillingView />}
      <Tabs defaultActiveKey="transactions" items={tabItems} />
    </div>
  );
};

export default BillingPage;
