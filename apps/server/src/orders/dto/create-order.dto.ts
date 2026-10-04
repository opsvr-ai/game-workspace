import {
  IsEnum, IsString, IsNumber, IsBoolean, IsOptional, Min,
} from 'class-validator';
import { OrderType, DispatchType } from '@chunlv/shared';

export class CreateOrderDto {
  @IsEnum(OrderType) type: OrderType;
  @IsOptional() @IsString() studioId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsEnum(DispatchType) dispatchType: DispatchType;
  @IsOptional() @IsString() source?: string;
  @IsNumber() @Min(0) amount: number;
  @IsString() gameName: string;
  @IsOptional() @IsNumber() duration?: number;
  @IsOptional() customFields?: Record<string, unknown>;
  @IsOptional() @IsString() companionId?: string;
  @IsOptional() @IsString() coCompanionId?: string;
  @IsOptional() @IsNumber() @Min(0) coAmount?: number;
  @IsOptional() @IsString() serviceType?: string;

  // Customer info fields
  @IsOptional() @IsString() customerSource?: string;
  @IsOptional() @IsString() customerSourceAccount?: string;
  @IsOptional() @IsString() customerNickname?: string;
  @IsOptional() @IsString() customerAccountId?: string;
  @IsOptional() @IsString() customerPlatformAccount?: string;
  @IsOptional() @IsString() customerWechat?: string;
  @IsOptional() @IsString() customerYy?: string;
  @IsOptional() @IsString() customerWechatQr?: string;
  @IsOptional() @IsString() customerRoomCode?: string;

  // Delta Force sub-fields
  @IsOptional() @IsString() deltaMission?: string;
  @IsOptional() @IsString() deltaCount?: string;
  @IsOptional() @IsString() deltaNote?: string;

  // Billing
  @IsOptional() @IsString() billingMode?: string;

  // Urgency
  @IsOptional() @IsString() urgency?: string;

  /**
   * 这张单先给谁抢（老板 2026-09-29）：OFFLINE_FIRST（默认/不填）= 先给本店线下，
   * ONLINE_FIRST = 先给桥接 + 线上俱乐部，本店线下陪玩先看不见。
   */
  @IsOptional() @IsString() poolScope?: string;

  // 预约时间（客服自由文本）
  @IsOptional() @IsString() scheduledTimeText?: string;

  // Payment tracking
  @IsOptional() @IsString() paymentAccountId?: string;
  @IsOptional() @IsBoolean() isCompensation?: boolean;
  @IsOptional() @IsString() transferScreenshotUrl?: string;
  @IsOptional() @IsBoolean() directAdd?: boolean;
  @IsOptional() @IsString() workWechatId?: string;
  @IsOptional() @IsString() workWechatName?: string;
  @IsOptional() @IsBoolean() csCultivated?: boolean;
  /** 客服养好的客户重新派单时，指向原来那张单（追溯 + 流转明细用） */
  @IsOptional() @IsString() sourceOrderId?: string;

  /**
   * 陪玩自己录入客户、直接开单（首单/续单/复购）时是否用客户存单抵扣。
   * 老板 2026-10-04：双陪开新单也要能消耗存单，所以这里透传到自动建的会话上。
   */
  @IsOptional() @IsBoolean() useDeposit?: boolean;
}
