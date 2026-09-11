import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { UserRole, type ApiResponse } from '@chunlv/shared';
import { ContentCheckService } from './content-check.service';

@Controller('content-check')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS, UserRole.COMPANION)
export class ContentCheckController {
  constructor(private readonly service: ContentCheckService) {}

  @Get('lexicon')
  async lexicon(): Promise<ApiResponse<unknown>> {
    return { code: 200, message: 'ok', data: this.service.getLexicon() };
  }

  @Get('weekly-plan')
  async weeklyPlan(@Query('count') count?: string, @Query('mode') mode?: string): Promise<ApiResponse<unknown>> {
    return { code: 200, message: 'ok', data: await this.service.generateWeeklyPlan(Number(count || 30), mode || 'weekly') };
  }

  @Post('generate-plan')
  async generatePlan(
    @Body() dto: { count?: number; mode?: 'weekly' | 'daily'; useAi?: boolean; keywords?: string[] },
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 200,
      message: 'ok',
      data: await this.service.generatePlan(
        Number(dto?.count || 30),
        dto?.mode || 'weekly',
        dto?.useAi === true,
        dto?.keywords || [],
      ),
    };
  }

  @Post('rewrite-row')
  async rewriteRow(@Body() dto: any): Promise<ApiResponse<unknown>> {
    return { code: 200, message: 'ok', data: await this.service.rewritePlanRow(dto) };
  }

  @Post('benchmark-generate')
  async benchmarkGenerate(
    @Body() dto: { count?: number; notes?: any[]; keywords?: string[]; benchmarkSummary?: string },
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 200,
      message: 'ok',
      data: await this.service.generateBenchmarkPlan(
        Number(dto?.count || 30),
        dto?.notes || [],
        dto?.keywords || [],
        dto?.benchmarkSummary || '',
      ),
    };
  }

  @Post('benchmark-analyze')
  async benchmarkAnalyze(@Body() dto: { notes?: any[] }): Promise<ApiResponse<unknown>> {
    return { code: 200, message: 'ok', data: await this.service.generateBenchmarkAnalysis(dto?.notes || []) };
  }

  @Post('check')
  async check(@Req() req: any, @Body() dto: any): Promise<ApiResponse<unknown>> {
    return { code: 200, message: 'ok', data: await this.service.check(req.user, dto) };
  }
}
