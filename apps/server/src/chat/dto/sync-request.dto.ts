import { IsArray, IsString, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class RoomSyncState {
  @IsString()
  roomId: string;

  @IsNumber()
  lastKnownSeq: number;
}

export class SyncRequestDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoomSyncState)
  rooms: RoomSyncState[];
}
