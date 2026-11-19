import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class ProjectDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  notes?: string;

  @IsObject()
  design!: Record<string, unknown>;

  @IsObject()
  scenario!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;

  @IsOptional()
  @IsObject()
  lastRun?: Record<string, unknown>;

  /** Client timestamps, ms. */
  @IsNumber()
  createdAt!: number;

  @IsNumber()
  updatedAt!: number;

  /** Server `rev` this edit was based on; absent for a project never synced. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  baseRev?: number;

  /** Overwrite even if the server has a newer revision (after resolving a conflict). */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class VersionDto {
  @IsUUID()
  id!: string;

  @IsNumber()
  at!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsBoolean()
  auto!: boolean;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  notes?: string;

  @IsObject()
  design!: Record<string, unknown>;

  @IsObject()
  scenario!: Record<string, unknown>;
}

export class ShareDto {
  /** `live` follows the latest save, `snapshot` freezes the current one. */
  @IsIn(['live', 'snapshot'])
  mode!: 'live' | 'snapshot';
}
