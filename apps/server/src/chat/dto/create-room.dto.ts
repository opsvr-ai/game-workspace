import { IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  participantId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  orderInfo?: string;
}
