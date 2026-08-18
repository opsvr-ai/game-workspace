import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import { ManagedPcService } from './managed-pc.service';

@Controller('managed-pcs')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
export class ManagedPcController {
  constructor(private readonly service: ManagedPcService) {}

  @Get()
  async list() {
    return { code: 200, data: await this.service.list() };
  }

  @Post()
  async create(@Body() body: { ip: string; loginAccount: string; macAddress?: string; label?: string }) {
    return { code: 200, data: await this.service.create(body) };
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Partial<{ ip: string; loginAccount: string; macAddress?: string; label?: string; enabled: boolean }>,
  ) {
    return { code: 200, data: await this.service.update(id, body) };
  }

  @Post('sync-mac')
  async syncMac() {
    return { code: 200, data: await this.service.syncAllMacAddresses() };
  }

  @Post('batch-power')
  async batchPower(
    @Body() body: { ids: string[]; action: 'wake' | 'shutdown' | 'restart' | 'sleep' | 'hibernate' },
  ) {
    return { code: 200, data: await this.service.batchPower(body.ids, body.action) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return { code: 200, data: await this.service.remove(id) };
  }

  @Post(':id/power')
  async power(
    @Param('id') id: string,
    @Body() body: { action: 'wake' | 'shutdown' | 'restart' | 'sleep' | 'hibernate' },
  ) {
    return { code: 200, data: await this.service.powerAction(id, body.action) };
  }
}
