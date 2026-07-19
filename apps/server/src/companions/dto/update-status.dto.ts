import { IsEnum } from 'class-validator';
import { CompanionStatus } from '@chunlv/shared';

export class UpdateStatusDto {
  @IsEnum(CompanionStatus)
  status: CompanionStatus;
}
