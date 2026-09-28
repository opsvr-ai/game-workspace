import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { canSeeCustomerSource, stripCustomerSourceDeep, type StripSourceOptions } from './order-privacy';

/**
 * 陪玩端响应体里一律不带「客户来源（小红书 / 抖音…）」和「来源账号」。
 *
 * 老板 2026-09-29：「陪玩端 隐藏 客户小红书信息」。挂在 OrdersController 上，
 * 订单列表 / 订单池 / 抢单 / 详情 / 改单…… 这一层的每个接口都会统一过一遍，
 * 不用每个方法各写一次，也堵住「以后新加接口忘了过滤」。
 *
 * 客服 / 店长 / 老板照常：来源账号那点「客服只看自己发的单」的差异，
 * 仍旧由 service 里的 `canSeeSourceAccount` 管，这里不碰。
 */
/** 两个拦截器只差一个「要不要连 `customer.platform` 一起清」，这里统一收一下。 */
abstract class BaseCustomerSourceMaskInterceptor implements NestInterceptor {
  protected abstract readonly opts: StripSourceOptions;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = context.switchToHttp().getRequest()?.user;
    if (!user || canSeeCustomerSource(user)) return next.handle();
    return next.handle().pipe(map((payload) => stripCustomerSourceDeep(payload, this.opts)));
  }
}

/**
 * 订单类接口的版本（OrdersController）：连 `customer.platform` 一起清 —— 那个字段
 * 在订单里存的就是来源（小红书 / 抖音），订单列表那一格的兜底正是它。
 */
@Injectable()
export class CustomerSourceMaskInterceptor extends BaseCustomerSourceMaskInterceptor {
  protected readonly opts: StripSourceOptions = { platform: true };
}

/**
 * 客户档案接口的版本（CustomersController）：只摘 `customFields` 里的来源 / 来源账号，
 * **不动** `customer.platform` —— 客户档案里这个字段还兼着「微信 / QQ / 电话」，
 * 清掉会让陪玩端把客户的 QQ / 电话显示成「未绑定」。
 */
@Injectable()
export class CustomerProfileSourceMaskInterceptor extends BaseCustomerSourceMaskInterceptor {
  protected readonly opts: StripSourceOptions = { platform: false };
}
