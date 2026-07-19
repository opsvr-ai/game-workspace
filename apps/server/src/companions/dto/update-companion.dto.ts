import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class GameProfileDto {
  @IsString()
  game: string;

  @IsString()
  rank: string;

  @IsBoolean()
  hasAccount: boolean;
}

export class UpdateCompanionDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GameProfileDto)
  gameProfiles?: GameProfileDto[];
}
