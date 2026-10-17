import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { actorOfStudio, scopeWhere } from '../common/scope';

@Injectable()
export class AuthorizationService {
  constructor(private prisma: PrismaService) {}

  async getAuthorizations(studioId: string) {
    return this.prisma.tenantAuthorization.findMany({ where: scopeWhere(actorOfStudio(studioId, 'ADMIN')) });
  }

  async updateAuthorization(studioId: string, csUserId: string, data: any) {
    return this.prisma.tenantAuthorization.upsert({
      where: { studioId_csUserId: { studioId, csUserId } },
      create: { studioId, csUserId, ...data },
      update: data,
    });
  }
}
