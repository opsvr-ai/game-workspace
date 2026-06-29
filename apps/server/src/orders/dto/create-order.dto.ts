import {
  IsEnum, IsString, IsNumber, IsBoolean, IsOptional, Min,
} from 'class-validator';
import { OrderType, DispatchType } from '@chunlv/shared';

export class CreateOrderDto {
  @IsEnum(OrderType) type: OrderType;
  @IsOptional() @IsString() studioId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsEnum(DispatchType) dispatchType: DispatchType;
  @IsNumber() @Min(0) amount: number;
  @IsString() gameName: string;
  @IsOptional() @IsNumber() duration?: number;
  @IsOptional() customFields?: Record<string, unknown>;
  @IsOptional() @IsBoolean() isOnline?: boolean;
  @IsOptional() @IsString() companionId?: string;

  // Customer info fields
  @IsOptional() @IsString() customerSource?: string;
  @IsOptional() @IsString() customerPlatformAccount?: string;
  @IsOptional() @IsString() customerWechat?: string;
  @IsOptional() @IsString() customerRoomCode?: string;

  // Delta Force sub-fields
  @IsOptional() @IsString() deltaMode?: string;
  @IsOptional() @IsString() deltaMission?: string;
  @IsOptional() @IsString() deltaCount?: string;
  @IsOptional() @IsString() deltaNote?: string;

  // Billing
  @IsOptional() @IsString() billingMode?: string;
}
