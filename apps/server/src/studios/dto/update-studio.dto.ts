import { IsEnum, IsOptional, IsString } from 'class-validator';
import { StudioType } from '@chunlv/shared';

export class UpdateStudioDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(StudioType)
  type?: StudioType;

  @IsOptional()
  @IsString()
  splitMode?: string;
}
