import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import { ProfitSplitService } from './profit-split.service';

@Controller('profit-split')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ProfitSplitController {
  constructor(private readonly service: ProfitSplitService) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async get() {
    return { code: 200, data: await this.service.get() };
  }

  @Post()
  @Roles(UserRole.OWNER)
  async save(@Body() dto: any) {
    return { code: 200, data: await this.service.save(dto) };
  }
}
