import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CompanionAttendanceService } from './companion-attendance.service';
import { presence } from '../common/presence';

/**
 * 「到点补卡」巡检（老板 2026-10-07）。
 *
 * 背景：上班卡以前是「客户端连上服务器的那一刻」——客服端 / 店长端开机自启、看门狗重拉、
 * 断线重连都会写卡，于是凌晨 00:0x 被记成上班时间，又因为早于上班时间被判成「正常」，
 * 老板在运营看板上看到的就是「上班 00:12 / 下班 03:51 / 正常」这种读不懂的考勤。
 *
 * 现在连接只在班次内算数（CompanionAttendanceService.isWithinShift），可「凌晨就开机、
 * 一整天没断过」的人不会再有连接事件，光靠连接写卡他们会整天显示「未打卡」。
 * 所以这里每分钟巡一次：班次内、人还在线、当天还没有卡 → 按「上班时间」补一张卡。
 */
@Injectable()
export class AttendancePunchSweepService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: CompanionAttendanceService,
  ) {}

  onModuleInit(): void {
    setInterval(() => {
      void this.tick();
    }, 60 * 1000);
  }

  async tick(): Promise<void> {
    const onlineUserIds = presence
      .snapshot()
      .filter((e) => e.sockets > 0)
      .map((e) => e.userId);
    if (!onlineUserIds.length) return;

    // 客服 / 店长：连接还在 = 人还在岗。
    const staff = await this.prisma.user.findMany({
      where: { id: { in: onlineUserIds }, role: { in: ['CS', 'ADMIN'] }, resignedAt: null },
      select: { id: true, role: true },
    });
    for (const u of staff) {
      await this.attendance.punchInForStaffOnDuty(u.id, u.role).catch(() => false);
    }

    // 陪玩：店长把陪玩考勤打开时才有意义（默认关，补卡会自己跳过）。
    const companions = await this.prisma.companion.findMany({
      where: { userId: { in: onlineUserIds }, isResigned: false },
      select: { id: true },
    });
    for (const c of companions) {
      await this.attendance.punchInForCompanionOnDuty(c.id).catch(() => false);
    }
  }
}
