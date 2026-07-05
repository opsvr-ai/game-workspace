import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import { ProcessBlacklistService } from './process-blacklist.service';
import { PrismaService } from '../prisma/prisma.service';
import { logger } from '../common/logger';
import { WsGateway } from '../ws/ws.gateway';
import { CreateBlacklistDto, UpdateBlacklistDto } from './dto/create-blacklist.dto';
import { CreateWhitelistDto } from './dto/create-whitelist.dto';
import { PushBlacklistDto } from './dto/push-blacklist.dto';
import { ProcessReportDto } from './dto/process-report.dto';
import { KillReportDto } from './dto/kill-report.dto';
import { CreateCompanionOverrideDto } from './dto/companion-override.dto';

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ProcessBlacklistController {
  constructor(
    private readonly service: ProcessBlacklistService,
    private readonly wsGateway: WsGateway,
    private readonly prisma: PrismaService,
  ) {}

  /** Resolve studioId for OWNER role (who has null studioId). */
  private async sid(req: any): Promise<string> {
    if (req.user.studioId) return req.user.studioId;
    const studio = await this.prisma.studio.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    return studio?.id || '';
  }


  // ── Companion self-service (REST fallback when WS disconnected) ──

  @Get('blacklist/my-rules')
  @Roles(UserRole.COMPANION)
  async getMyRules(@Req() req: any) {
    const companionId = req.user.companionId;
    if (!companionId) return { code: 400, message: '当前用户不是陪玩', data: null };
    const [blacklist, whitelist] = await Promise.all([
      this.service.getEffectiveBlacklist(companionId),
      this.service.getWhitelist(req.user.studioId),
    ]);
    logger.info('REST my-rules', { companionId, blacklistCount: blacklist.length, whitelistCount: whitelist.length });
    return { code: 200, data: { blacklist, whitelist, version: Date.now() } };
  }

  // ── Blacklist CRUD (ADMIN, OWNER) ──

  @Get('blacklist')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async listBlacklist(@Req() req: any, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const items = await this.service.listBlacklist(await this.sid(req), Number(page) || 1, Number(pageSize) || 20);
    return { code: 200, data: items };
  }

  @Post('blacklist')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async addBlacklist(@Req() req: any, @Body() dto: CreateBlacklistDto) {
    const entry = await this.service.addBlacklist(await this.sid(req), dto.processName, dto.processPath);
    return { code: 200, data: entry, message: '已添加到黑名单' };
  }

  @Put('blacklist/:id')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async updateBlacklist(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateBlacklistDto) {
    const entry = await this.service.updateBlacklist(id, await this.sid(req), dto);
    return { code: 200, data: entry, message: '已更新' };
  }

  @Delete('blacklist/:id')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async removeBlacklist(@Req() req: any, @Param('id') id: string) {
    await this.service.removeBlacklist(id, await this.sid(req));
    return { code: 200, message: '已删除' };
  }

  // ── Push ──

  @Post('blacklist/push')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async pushBlacklist(@Req() req: any, @Body() dto: PushBlacklistDto) {
    let companionIds: string[];
    if (dto.targetAll) {
      companionIds = await this.service.getStudioCompanionIds(await this.sid(req));
    } else if (dto.companionIds && dto.companionIds.length > 0) {
      companionIds = dto.companionIds;
    } else {
      return { code: 400, message: '请指定目标陪玩或选择全部推送' };
    }

    let pushed = 0;
    const version = Date.now();
    const whitelist = await this.service.getWhitelist(await this.sid(req));
    for (const cid of companionIds) {
      const blacklist = await this.service.getEffectiveBlacklist(cid);
      this.wsGateway.sendBlacklistUpdate(cid, blacklist, whitelist, version);
      pushed++;
    }
    return { code: 200, data: { pushed, version }, message: `已向 ${pushed} 个陪玩推送黑名单` };
  }

  // ── Companion Overrides (ADMIN, OWNER) ──

  @Get('blacklist/companions/:companionId/overrides')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async listOverrides(@Param('companionId') companionId: string) {
    const items = await this.service.listCompanionOverrides(companionId);
    return { code: 200, data: items };
  }

  @Post('blacklist/companions/:companionId/overrides')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async addOverride(@Param('companionId') companionId: string, @Body() dto: CreateCompanionOverrideDto) {
    const entry = await this.service.addCompanionOverride(companionId, dto.processName, dto.processPath);
    return { code: 200, data: entry, message: '已添加个人黑名单覆盖' };
  }

  @Delete('blacklist/companions/:companionId/overrides/:overrideId')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async removeOverride(@Param('companionId') companionId: string, @Param('overrideId') overrideId: string) {
    await this.service.removeCompanionOverride(overrideId, companionId);
    return { code: 200, message: '已删除覆盖' };
  }

  // ── Whitelist (ADMIN, OWNER) ──

  @Get('whitelist')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async listWhitelist(@Req() req: any) {
    const items = await this.service.getWhitelist(await this.sid(req));
    return { code: 200, data: items };
  }

  @Post('whitelist')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async addWhitelist(@Req() req: any, @Body() dto: CreateWhitelistDto) {
    const entry = await this.service.addWhitelist(await this.sid(req), dto.processName, dto.processPath);
    return { code: 200, data: entry, message: '已添加到白名单' };
  }

  @Delete('whitelist/:id')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async removeWhitelist(@Req() req: any, @Param('id') id: string) {
    await this.service.removeWhitelist(id, await this.sid(req));
    return { code: 200, message: '已删除白名单条目' };
  }

  // ── Process Reports (viewing) ──

  @Get('processes/reports')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async getReports(@Req() req: any, @Query('companionId') companionId?: string, @Query('limit') limit?: string) {
    const reports = await this.service.getRecentReports(await this.sid(req), companionId, Number(limit) || 20);
    return { code: 200, data: reports };
  }

  @Get('processes/unique-names')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async getUniqueNames(@Query('companionId') companionId: string) {
    if (!companionId) return { code: 400, message: '请指定陪玩ID', data: null };
    const names = await this.service.getUniqueProcessNames(companionId);
    return { code: 200, data: names };
  }

  @Get('processes/reports/:companionId')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async getLatestReport(@Param('companionId') companionId: string) {
    const report = await this.service.getLatestReport(companionId);
    return { code: 200, data: report };
  }

  // ── Companion endpoints ──

  @Post('processes/reports')
  @Roles(UserRole.COMPANION)
  async submitReport(@Req() req: any, @Body() dto: ProcessReportDto) {
    logger.info("RECV REST process report", { companionId: req.user.companionId, username: req.user.username, totalCount: dto.totalCount });
    const report = await this.service.saveProcessReport(req.user.companionId, dto.processes, dto.totalCount);
    return { code: 200, data: report, message: '进程报告已保存' };
  }

  @Get('processes/kill-logs')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async getKillLogs(
    @Req() req: any,
    @Query('companionId') companionId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const logs = await this.service.getKillLogs(await this.sid(req), companionId, Number(page) || 1, Number(pageSize) || 20);
    return { code: 200, data: logs };
  }

  @Post('processes/kill-report')
  @Roles(UserRole.COMPANION)
  async submitKillReport(@Req() req: any, @Body() dto: KillReportDto) {
    const log = await this.service.logKill(
      req.user.companionId, dto.processName, dto.pid, dto.success, dto.resultText, undefined, dto.triggeredBy,
    );
    return { code: 200, data: log, message: '杀进程日志已记录' };
  }
}
