// craftsman-ignore: TS001,TS003
import { Injectable, NotFoundException, ForbiddenException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { BridgeService } from '../studios/bridge.service';
import { OrderWorkflowService } from './order-workflow.service';
import { OrderDispatchService } from './order-dispatch.service';
import { CsFinanceService } from './cs-finance.service';
import { OrderCsService } from './order-cs.service';
import { OrderCreateService } from './order-create.service';
import { OrderQueryService } from './order-query.service';
import { OrderExceptionService } from './order-exception.service';
import { OrderSessionService } from './order-session.service';
import { OrderTransferService } from './order-transfer.service';
import { CompanionQuotaService } from './companion-quota.service';
import { ExcellenceService } from '../companions/excellence.service';
import { stripPoolCustomerContact } from '../common/order-privacy';
import { PoolScope } from '@chunlv/shared';

@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly csFinance: CsFinanceService;
  private readonly orderCs: OrderCsService;
  private readonly orderCreate: OrderCreateService;
  private readonly orderQuery: OrderQueryService;
  private readonly orderException: OrderExceptionService;
  private readonly orderSession: OrderSessionService;
  private readonly orderTransfer: OrderTransferService;

  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
    private bridgeService: BridgeService,
    private readonly workflowService: OrderWorkflowService,
    private readonly dispatchService: OrderDispatchService,
    excellence: ExcellenceService,
    quota: CompanionQuotaService,
    // CS 微信收款 / 资金流水 / 对账子域（Nest 注入）。
    // 参数写成可选只是为了不破坏现有单测里的 `new OrdersService(...)`；这里按同样的依赖补一个实例，
    // 门面就不需要 `!` 非空断言 —— 生产环境漏注册 provider 时 Nest 会直接启动失败，而不是等接口调用才炸。
    csFinance?: CsFinanceService,
    orderTransfer?: OrderTransferService,
    orderSession?: OrderSessionService,
    orderException?: OrderExceptionService,
    orderQuery?: OrderQueryService,
    orderCreate?: OrderCreateService,
    orderCs?: OrderCsService,
  ) {
    this.csFinance = csFinance ?? new CsFinanceService(prisma, wsGateway);
    this.orderQuery = orderQuery ?? new OrderQueryService(prisma, bridgeService, excellence, quota);
    this.orderException = orderException ?? new OrderExceptionService(prisma, wsGateway, bridgeService, quota);
    this.orderSession = orderSession ?? new OrderSessionService(prisma, wsGateway, bridgeService);
    this.orderTransfer = orderTransfer ?? new OrderTransferService(prisma, wsGateway);
    this.orderCreate = orderCreate ?? new OrderCreateService(prisma, wsGateway, this.orderSession);
    this.orderCs = orderCs ?? new OrderCsService(prisma, wsGateway, bridgeService);
  }

  onModuleInit(): void {
    // 服务重启后，setTimeout 会丢失；这里定时兜底清理过期未接受的搭档邀请，
    // 避免客户管理里一直显示“等待搭档接受/取消邀请”。
    setInterval(() => {
      void this.orderSession.cleanupExpiredPartnerInvites();
      // 同一根因：转让申请是「发起方落库 + 等对方同意」，服务重启也会丢通知，
      // 挂久了界面上就一直有个没人认的申请，一起清。
      void this.orderTransfer.cleanupExpiredTransferRequests();
    }, 30 * 1000);
  }

  async create(dto: {
    type: string;
    studioId?: string;
    csUserId: string;
    customerId?: string;
    customerWechat?: string;
    customerRoomCode?: string;
    dispatchType: string;
    amount: number;
    gameName: string;
    duration?: number;
    customFields?: any;
    companionId?: string;
    /** 陪玩自己录入客户、直接开单时是否用客户存单抵扣（落到自动建的会话上，双陪也走这条） */
    useDeposit?: boolean;
  }) {
    return this.orderCreate.create(dto);
  }

  async findPool(companionId?: string, studioId?: string) {
    return this.orderQuery.findPool(companionId, studioId);
  }

  async dispatchSummary(user: any) {
    return this.orderQuery.dispatchSummary(user);
  }

  async findAll(
    user: any,
    status?: string,
    scope?: string,
    page?: number,
    pageSize?: number,
    filters?: any,
  ): Promise<any> {
    return this.orderQuery.findAll(user, status, scope, page, pageSize, filters);
  }

  async grab(orderId: string, companionId: string) {
    return this.workflowService.grab(orderId, companionId);
  }

  async findPendingStart(companionId: string) {
    return this.orderQuery.findPendingStart(companionId);
  }

  async updateContact(orderId: string, body: any) {
    return this.orderCs.updateContact(orderId, body);
  }

  async joinRoom(orderId: string, user: any) {
    return this.orderCs.joinRoom(orderId, user);
  }

  async listSupplements(user: any, scope?: 'pending' | 'due' | 'records' | 'all') {
    return this.orderException.listSupplements(user, scope);
  }

  async supplementSummary(user: any) {
    return this.orderException.supplementSummary(user);
  }

  async decideSupplement(id: string, decision: string, note: string | undefined, user: any) {
    return this.orderException.decideSupplement(id, decision, note, user);
  }

  async supplementOrder(orderId: string, user: any, body: { reason?: string }) {
    return this.orderException.supplementOrder(orderId, user, body);
  }

  async requestRefund(orderId: string, user: any, body: { reason?: string; evidenceUrl?: string }) {
    return this.orderException.requestRefund(orderId, user, body);
  }

  async reviewSupplement(id: string, result: string, user: any) {
    return this.orderException.reviewSupplement(id, result, user);
  }

  /**
   * 「线上→线下流转」的单：客服 / 店长点一下放给本店线下陪玩（老板 2026-10-01：
   * 「孙或店长点一下『也放给线下陪玩』」）。没人点也会在
   * `pool.online_first_release_minutes` 分钟后自动放行（判定在 findPool 里，纯读时计算）。
   */
  async releaseToOffline(orderId: string, user: any) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });

    if (!order) throw new NotFoundException('订单不存在');
    if (user?.role !== 'OWNER' && user?.studioId) {
      const visibleIds = await this.bridgeService.getVisibleStudioIds(user.studioId);
      if (!visibleIds.includes(order.studioId)) throw new ForbiddenException('无权操作其他工作室的订单');
    }
    if (order.poolScope !== PoolScope.ONLINE_FIRST) {
      throw new ForbiddenException('这张单本来就是线下→线上流转（本店线下先抢），不用放');
    }
    if (order.releasedToOfflineAt) return order; // 已经放过，重复点不报错
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { releasedToOfflineAt: new Date() },
    });
    this.wsGateway.broadcastToStudio(updated.studioId, 'order:pool_updated', updated);
    // 老板 2026-10-01：放给线下时本店每个陪玩都要弹一次（原来只是悄悄进池子）。
    void this.broadcastReleasedToOffline(updated).catch(() => null);
    return updated;
  }

  async getPopupSeconds(studioId: string | null): Promise<number> {
    return this.orderCreate.getPopupSeconds(studioId);
  }

  /**
   * 「线上→线下流转」的单放给本店线下时，给本店每个陪玩弹一次（老板 2026-10-01）。
   * 收件人规则跟广播一致（空闲 / 挂机一定弹，娱乐中 / 接单中看本人开关）。
   */
  async broadcastReleasedToOffline(order: any): Promise<void> {
    if (!order?.studioId) return;
    const popupCreator = await this.prisma.user
      .findUnique({ where: { id: order.csUserId }, select: { username: true, role: true } })
      .catch(() => null);
    const popupSeconds = await this.getPopupSeconds(order.studioId);
    await this.wsGateway.broadcastNewOrder(order.studioId, {
      ...stripPoolCustomerContact(order),
      _createdBy: popupCreator?.username || '未知',
      _creatorRole: popupCreator?.role || 'CS',
      _popupSeconds: popupSeconds,
      _broadcast: true,
      _releasedToOffline: true,
    });
  }

  async recordOutcome(
    orderId: string,
    user: any,
    body: { outcome?: string; reason?: string; note?: string; evidence?: unknown },
  ) {
    return this.orderException.recordOutcome(orderId, user, body);
  }

  async confirmOutcomeWithCs(orderId: string, user: any, body: { note?: string }) {
    return this.orderException.confirmOutcomeWithCs(orderId, user, body);
  }

  async rejectOrderOutcome(orderId: string, user: any, body: { note?: string }) {
    return this.orderException.rejectOrderOutcome(orderId, user, body);
  }

  async reviewOrderOutcome(orderId: string, user: any, body: { responsibility?: string; note?: string }) {
    return this.orderException.reviewOrderOutcome(orderId, user, body);
  }

  async listOrderReviews(
    user: any,
    scope: 'waiting' | 'recheck' | 'archived' | 'decided' = 'waiting',
  ) {
    return this.orderException.listOrderReviews(user, scope);
  }

  async orderReviewSummary(user: any) {
    return this.orderException.orderReviewSummary(user);
  }

  async chaseFeedback(orderId: string, user: any) {
    return this.orderException.chaseFeedback(orderId, user);
  }

  async requestTransfer(
    orderId: string,
    fromCompanionId: string,
    toCompanionId: string,
    reason?: string,
  ) {
    return this.orderTransfer.requestTransfer(orderId, fromCompanionId, toCompanionId, reason);
  }

  async acceptTransferRequest(requestId: string, toCompanionId: string) {
    return this.orderTransfer.acceptTransferRequest(requestId, toCompanionId);
  }

  async rejectTransferRequest(requestId: string, toCompanionId: string, reason?: string) {
    return this.orderTransfer.rejectTransferRequest(requestId, toCompanionId, reason);
  }

  async cancelTransferRequest(requestId: string, fromCompanionId: string) {
    return this.orderTransfer.cancelTransferRequest(requestId, fromCompanionId);
  }

  async listMyTransferRequests(companionId: string) {
    return this.orderTransfer.listMyTransferRequests(companionId);
  }

  async updateOrderInfo(orderId: string, user: any, dto: any) {
    return this.orderCs.updateOrderInfo(orderId, user, dto);
  }

  async updateAmount(orderId: string, companionId: string, amount: number) {
    return this.orderCs.updateAmount(orderId, companionId, amount);
  }

  async compensateCustomer(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    const customer = await this.prisma.customer.create({
      data: {
        studioId: order.studioId,
        wechatId: 'BC-' + order.id.slice(0, 8),
        companionId: order.companionId,
        customerCode: 'BC' + Date.now().toString(36).toUpperCase(),
        notes: '补单客户（原订单 ' + order.id + '）',
      },
    });
    return customer;
  }

  async assign(orderId: string, companionId: string, userStudioId?: string) {
    return this.dispatchService.assign(orderId, companionId, userStudioId);
  }

  async acceptAssignment(orderId: string, companionId: string) {
    return this.dispatchService.acceptAssignment(orderId, companionId);
  }

  async declineAssignment(orderId: string, companionId: string) {
    return this.dispatchService.declineAssignment(orderId, companionId);
  }

  async quickGrab(orderId: string, companionId: string) {
    return this.dispatchService.quickGrab(orderId, companionId);
  }

  async findUrgent(studioId: string, user?: { id: string; role: string }) {
    return this.orderQuery.findUrgent(studioId, user);
  }

  async markCsContact(
    orderId: string,
    status: string,
    evidenceUrl?: string,
    extra?: { workWechatId?: string; workWechatName?: string; addResult?: string; failReason?: string; note?: string },
    user?: { id: string; role: string },
  ) {
    return this.orderCs.markCsContact(orderId, status, evidenceUrl, extra, user);
  }

  async redispatch(
    orderId: string,
    studioId?: string,
    user?: { id: string; role: string },
    body?: { poolScope?: string },
  ) {
    return this.orderCs.redispatch(orderId, studioId, user, body);
  }

  async markPoolHandled(orderId: string, user?: { id: string; role: string }) {
    return this.orderCs.markPoolHandled(orderId, user);
  }

  async markCultivatedTaken(
    orderId: string,
    user: { id: string; role: string },
    body: { companionId?: string; actualOrderCode?: string },
  ) {
    return this.orderCs.markCultivatedTaken(orderId, user, body);
  }

  async listCsFollowup(studioId: string, user?: { id: string; role: string }) {
    return this.csFinance!.listCsFollowup(studioId, user);
  }

  // 客服养好的客户重新派单后，被谁抢走、陪玩用什么微信、最终去了线下/桥接/线上
  async listCsConverted(studioId: string, user?: { id: string; role: string }) {
    return this.csFinance!.listCsConverted(studioId, user);
  }

  /**
   * 「线下→线上流转」的单，线下没人接、被桥接工作室 / 线上俱乐部接走 —— 统计 + 标注
   * （老板 2026-09-29：「选择线下+线上入池的时候，线下没人接，被桥接工作室或者线上俱乐部接走
   * 你要做好统计，并做好标注，记录好机密还是绝密、应收多少，钱在哪里等信息并做好汇总」）。
   *
   * 口径：
   *  - 只统计**本店**发的、入池方式 =「线下→线上流转」的单（poolScope 不是 ONLINE_FIRST）；
   *  - 只统计**已经被人抢走**、而且抢的人不是本店线下（桥接工作室 / 线上俱乐部）的单；
   *  - **桥接工作室** = 「首单不结」模式：机密 35 元/人/时、绝密 30 元/人/时是工作室净得的；
   *  - **线上俱乐部** = 「抽成」模式：工作室拿 100 − 陪玩分成（revenue.club_companion_share）；
   *  - 应收 = 客户按业绩（单价 × 时长，双陪算两份）；
   *  - 应返还 = 绝密单返还给接单方（默认 15 元/人/小时，双陪 ×2）；机密首单不结、不返还。
   */
  async listEscalatedPoolOrders(studioId: string, opts?: { month?: string; csUserId?: string }) {
    return this.csFinance!.listEscalatedPoolOrders(studioId, opts);
  }

  async listMoneyFlows(orderId: string) {
    return this.csFinance!.listMoneyFlows(orderId);
  }

  async addMoneyFlow(
    orderId: string,
    data: { direction: string; amount: number; counterpart: string; counterpartId?: string; note?: string },
  ) {
    return this.csFinance!.addMoneyFlow(orderId, data);
  }

  // 客服每个工作微信的余额 = 流入(客户转入) - 流出(转给陪玩/桥接等) - 店长转走的余额
  // 客服角色只看自己绑定的工作微信，店长/老板看本工作室全部。
  async listCsWechatBalances(studioId: string, csUserId?: string) {
    return this.csFinance!.listCsWechatBalances(studioId, csUserId);
  }

  // 店长把客服微信里的余额转走，记录一笔清零业绩，让系统余额归零
  async clearCsWechatBalance(studioId: string, workWechatId: string, note?: string) {
    return this.csFinance!.clearCsWechatBalance(studioId, workWechatId, note);
  }

  // 店长转走余额统计：本月 / 今年 / 累计，跨所有客服工作微信
  async getCsWechatBalanceSummary(studioId: string) {
    return this.csFinance!.getCsWechatBalanceSummary(studioId);
  }

  // 客服工作微信收款明细：按微信聚合相关订单的每一笔业绩，并标出问题单。
  async listCsWechatFlow(studioId: string) {
    return this.csFinance!.listCsWechatFlow(studioId);
  }

  // 客服记完业绩后，检查这单账是否还有异常；有异常就提醒负责的客服去修改。
  async checkAndNotifyCsAnomaly(orderId: string) {
    return this.csFinance!.checkAndNotifyCsAnomaly(orderId);
  }

  async listMoneyReconciliation(studioId: string) {
    return this.csFinance!.listMoneyReconciliation(studioId);
  }

  async claim(
    orderId: string,
    csUserId: string,
    dto: {
      workWechatId?: string;
      workWechatName?: string;
      customerPaidTo?: string;
      customerPaymentAccountId?: string;
      customerPaymentAccountName?: string;
    },
    userStudioId?: string,
  ) {
    return this.orderCs.claim(orderId, csUserId, dto, userStudioId);
  }

  async releaseClaim(orderId: string, csUserId: string, userStudioId: string | undefined, role: string | undefined, urgency?: string) {
    return this.orderCs.releaseClaim(orderId, csUserId, userStudioId, role, urgency);
  }

  async confirm(orderId: string, companionId: string) {
    return this.workflowService.confirm(orderId, companionId);
  }

  async complete(orderId: string, userStudioId?: string, companionId?: string, role?: string) {
    return this.workflowService.complete(orderId, undefined, userStudioId, companionId, role);
  }

  async cancel(orderId: string, userStudioId?: string, companionId?: string, role?: string, reason?: string) {
    return this.workflowService.cancel(orderId, userStudioId, companionId, role, reason);
  }

  async markRefund(orderId: string, companionId?: string, reason?: string, label = '退款') {
    return this.orderException.markRefund(orderId, companionId, reason, label);
  }

  async markDeposit(orderId: string, companionId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new ForbiddenException('订单不存在');
    if (companionId && order.companionId !== companionId) throw new ForbiddenException('只能操作自己的订单');
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'DEPOSITED',
        depositedAt: new Date(),
        depositAmount: order.amount,
        notes: order.notes ? `${order.notes}\n[存单]` : '[存单]',
      },
    });
    if (order.customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: order.customerId }, select: { notes: true } });
      await this.prisma.customer.update({
        where: { id: order.customerId },
        data: {
          notes: customer?.notes
            ? `${customer.notes}\n[存单 ¥${order.amount || 0}]`
            : `[存单 ¥${order.amount || 0}]`,
        },
      });
    }
    if (order.companionId) {
      await this.prisma.companion
        .update({ where: { id: order.companionId }, data: { status: 'AVAILABLE' } })
        .catch(() => {});
      await this.wsGateway.refreshCompanionBlacklist(order.companionId).catch(() => {});
    }
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async alertBelowFloorPrice(order: any, session: any, info: any): Promise<void> {
    return this.orderSession.alertBelowFloorPrice(order, session, info);
  }

  async getPoolStatus(companionId: string) {
    return this.orderQuery.getPoolStatus(companionId);
  }

  async countPendingContact(studioId: string) {
    return this.orderQuery.countPendingContact(studioId);
  }

  async findOne(orderId: string, user?: any) {
    return this.orderQuery.findOne(orderId, user);
  }

  async getSessions(orderId: string) {
    return this.orderSession.getSessions(orderId);
  }

  async addSession(
    orderId: string,
    dto: {
      companionId: string;
      coCompanionId?: string;
      amount: number;
      coAmount?: number;
      duration?: number;
      claimedMode?: string;
      claimedPrice?: number;
      transferScreenshotUrl?: string;
      useDeposit?: boolean;
      /** 发起这次加段的陪玩（控制器从登录态取，别信前端 body.companionId） */
      actorCompanionId?: string;
      /** 单陪开段时服务端直接开始计时；双陪 / 广播找搭档必须等搭档接受，传 false */
      autoStart?: boolean;
      /** 代打：主陪不参与，只让副陪服务；主陪仍持有客户/KPI。 */
      proxyMode?: boolean;
    },
  ) {
    return this.orderSession.addSession(orderId, dto);
  }

  async acceptPartnerInvite(sessionId: string, partnerId: string) {
    return this.orderSession.acceptPartnerInvite(sessionId, partnerId);
  }

  async rejectPartnerInvite(sessionId: string, partnerId: string) {
    return this.orderSession.rejectPartnerInvite(sessionId, partnerId);
  }

  async broadcastPartnerInvite(sessionId: string) {
    return this.orderSession.broadcastPartnerInvite(sessionId);
  }

  // 门面委托（单测 orders.addsession-guard.test.ts 会直接调它校验归属判断）。
  async canActOnOrder(
    order: { id: string; companionId: string | null; coCompanionId: string | null; customerId: string | null },
    companionId: string,
  ): Promise<boolean> {
    return this.orderSession.canActOnOrder(order, companionId);
  }

  async startSession(
    id: string,
    companionId?: string,
    claims?: { claimedMode?: string; claimedPrice?: number; transferScreenshotUrl?: string; duration?: number; useDeposit?: boolean },
  ) {
    return this.orderSession.startSession(id, companionId, claims);
  }

  async pauseSession(id: string, companionId?: string) {
    return this.orderSession.pauseSession(id, companionId);
  }

  async resumeSession(id: string, companionId?: string) {
    return this.orderSession.resumeSession(id, companionId);
  }

  async endSession(id: string, companionId?: string) {
    return this.orderSession.endSession(id, companionId);
  }

  async continueSession(
    orderId: string,
    companionId: string | undefined,
    dto: { duration?: number; price?: number; coPrice?: number; claimedMode?: string; useDeposit?: boolean },
  ) {
    return this.orderSession.continueSession(orderId, companionId, dto);
  }

  async updatePayment(
    orderId: string,
    dto: {
      paymentAccountId?: string;
      companionFeeStatus?: string;
      companionFeeMethod?: string;
      companionFeeAccount?: string;
      companionFeeAmount?: number;
      customerPaidTo?: string;
      customerPaymentAccountId?: string;
      customerPaymentAccountName?: string;
    },
    user: any,
  ) {
    return this.orderCs.updatePayment(orderId, dto, user);
  }

}
