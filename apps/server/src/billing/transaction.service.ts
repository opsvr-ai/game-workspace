// craftsman-ignore: TS001
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  async createTransaction(dto: {
    orderId: string;
    companionId: string;
    amount: number;
    paymentMethod: string;
    screenshotUrl: string;
    paidAt: string;
  }) {
    return this.prisma.transaction.create({
      data: {
        orderId: dto.orderId,
        companionId: dto.companionId,
        amount: dto.amount,
        paymentMethod: dto.paymentMethod,
        screenshotUrl: dto.screenshotUrl,
        status: 'PENDING',
        paidAt: new Date(dto.paidAt),
      },
      include: {
        order: { select: { id: true, type: true, amount: true } },
        companion: {
          select: {
            id: true,
            user: { select: { username: true } },
          },
        },
      },
    });
  }

  async approve(transactionId: string, reviewerId: string, reviewerStudioId?: string, reviewerRole?: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { companion: { select: { studioId: true } } },
    });

    if (!tx) throw new NotFoundException('报账记录不存在');
    if (tx.status !== 'PENDING') throw new ForbiddenException('该报账已处理');
    // Studio isolation: non-OWNER can only review own studio's transactions
    if (reviewerRole !== 'OWNER' && reviewerStudioId && tx.companion?.studioId !== reviewerStudioId) {
      throw new ForbiddenException('无权审核其他工作室的报账');
    }

    // Revenue already recorded in OrderWorkflowService.complete() (C2 fix — unified entry point)
    // Transaction approve now only marks the audit record as reviewed

    return this.prisma.transaction.update({
      where: { id: transactionId },
      data: { status: 'APPROVED', reviewedById: reviewerId },
    });
  }

  async reject(transactionId: string, reviewerId: string, reviewerStudioId?: string, reviewerRole?: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { companion: { select: { studioId: true } } },
    });

    if (!tx) throw new NotFoundException('报账记录不存在');
    if (tx.status !== 'PENDING') throw new ForbiddenException('该报账已处理');
    if (reviewerRole !== 'OWNER' && reviewerStudioId && tx.companion?.studioId !== reviewerStudioId) {
      throw new ForbiddenException('无权审核其他工作室的报账');
    }

    return this.prisma.transaction.update({
      where: { id: transactionId },
      data: { status: 'REJECTED', reviewedById: reviewerId },
    });
  }

  async batchApprove(ids: string[], reviewerId: string, reviewerStudioId?: string, reviewerRole?: string) {
    const results = { succeeded: 0, failed: 0, errors: [] as string[] };

    for (const id of ids) {
      try {
        await this.approve(id, reviewerId, reviewerStudioId, reviewerRole);
        results.succeeded++;
      } catch (err: any) {
        results.failed++;
        results.errors.push(`${id}: ${err.message}`);
      }
    }

    return results;
  }

  async batchReject(ids: string[], reviewerId: string, reviewerStudioId?: string, reviewerRole?: string) {
    const results = { succeeded: 0, failed: 0, errors: [] as string[] };

    for (const id of ids) {
      try {
        await this.reject(id, reviewerId, reviewerStudioId, reviewerRole);
        results.succeeded++;
      } catch (err: any) {
        results.failed++;
        results.errors.push(`${id}: ${err.message}`);
      }
    }

    return results;
  }
}
