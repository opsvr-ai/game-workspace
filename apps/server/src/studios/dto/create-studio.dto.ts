import { IsEnum, IsString, IsOptional, MinLength } from 'class-validator';
import { StudioType } from '@chunlv/shared';

export class CreateStudioDto {
  @IsString()
  name: string;

  @IsEnum(StudioType)
  type: StudioType;

  @IsString()
  managerUsername: string;

  @IsString()
  @MinLength(6)
  managerPassword: string;

  @IsOptional()
  @IsString()
  managerDisplayName?: string;

  @IsOptional()
  @IsString()
  splitMode?: string;
}
