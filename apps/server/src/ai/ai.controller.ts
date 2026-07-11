import { Controller, Post, Param, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AiService } from './ai.service';
import { UserRole, ApiResponse } from '@chunlv/shared';

@Controller('ai')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('analyze/:customerId')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async analyze(@Param('customerId') id: string): Promise<ApiResponse<unknown>> {
    return { code: 200, message: 'ok', data: await this.aiService.analyzeCustomer(id) };
  }

  @Post('advice')
  @Roles(UserRole.COMPANION)
  async getAdvice(@Req() req: any): Promise<ApiResponse<unknown>> {
    return { code: 200, message: 'ok', data: await this.aiService.getAdvice(req.user.companionId) };
  }
}
