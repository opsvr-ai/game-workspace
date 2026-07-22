// craftsman-ignore: TS002
import { useEffect, useCallback } from 'react';
import { Modal, Tag } from 'antd';
import { useSocket } from '../hooks/useSocket';
import { ordersApi } from '../api/orders';

interface PartnerCallData {
  orderId: string;
  callerId: string;
  callerStudioName?: string;
  customerName?: string;
  gameName: string;
  amount: number;
}

export function PartnerCallNotification() {
  const handlePartnerCall = useCallback((data: PartnerCallData) => {
    const label = data.callerStudioName
      ? `来自${data.callerStudioName}的陪玩请求协作接单`
      : '陪玩请求协作接单';
    Modal.confirm({
      title: label,
      content: (
        <div>
          {data.callerStudioName && <Tag color="purple">{data.callerStudioName}</Tag>}
          <p>游戏: {data.gameName}</p>
          <p>金额: ¥{data.amount}</p>
          {data.customerName && <p>客户: {data.customerName}</p>}
        </div>
      ),
      okText: '接受协作',
      cancelText: '忽略',
      onOk: async () => {
        try {
          await ordersApi.acceptPartner(data.orderId);
        } catch { /* ignore */ }
      },
    });
  }, []);

  useSocket({ onPartnerCall: handlePartnerCall });

  return null;
}
