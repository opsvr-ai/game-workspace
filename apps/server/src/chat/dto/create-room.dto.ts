import { IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  participantId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  // null 是有意义的：显式传 null / 空串 = 把这个房间挂着的订单上下文清掉（人员列表点聊天）；
  // 字段整个不给 = 别动原来记着的那一单（从会话列表点进来）。
  orderInfo?: string | null;
}
