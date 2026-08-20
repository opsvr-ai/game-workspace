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

  // 预约时间（客服自由文本）
  @IsOptional() @IsString() scheduledTimeText?: string;

  // Payment tracking
  @IsOptional() @IsString() paymentAccountId?: string;
  @IsOptional() @IsBoolean() isCompensation?: boolean;
  @IsOptional() @IsString() transferScreenshotUrl?: string;
}
