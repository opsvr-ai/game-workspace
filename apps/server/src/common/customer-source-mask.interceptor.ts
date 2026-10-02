import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  canSeeCustomerSource,
  stripCustomerSourceForViewer,
  type StripSourceOptions,
} from './order-privacy';

/**
 * 响应体里「客户来源」这一组字段（来源平台 / 引流账号 / 客户昵称 / 客户账号ID）的可见性。
 *
 * 老板 2026-09-29：「陪玩端 隐藏 客户小红书信息」；
 * 老板 2026-10-02：「蠢驴电竞的客服发单，为什么桥接工作室的黄浩那边没抢单就能显示客户的小红书
 * 信息？……除了发单工作室的管理端能看到，其他人一律看不到」。
 *
 * 挂在 OrdersController / CustomersController 上，订单列表 / 订单池 / 抢单 / 详情 / 改单 /
 * 客户管理…… 这一层的每个接口都会统一过一遍，不用每个方法各写一次，
 * 也堵住「以后新加接口忘了过滤」。
 *
 * **逐条**判（不是按角色一刀切）：`stripCustomerSourceForViewer` 会看每条数据自己的
 * `studioId`，所以「客服的订单管理 / 抢单池里混着自家和桥接工作室的单」这种列表也是对的
 * —— 自家的看得到，别家的看不到。全站老板看全部；陪玩端一律看不到。
 */
/** 两个拦截器只差一个「要不要连 `customer.platform` 一起清」，这里统一收一下。 */
abstract class BaseCustomerSourceMaskInterceptor implements NestInterceptor {
  protected abstract readonly opts: StripSourceOptions;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = context.switchToHttp().getRequest()?.user;
    // 全站老板（不挂工作室）看全部，直接放行；其余人逐条判（`undefined` = 不看任何工作室）。
    if (!user || canSeeCustomerSource(user, undefined)) return next.handle();
    return next.handle().pipe(map((payload) => stripCustomerSourceForViewer(payload, user, this.opts)));
  }
}

/**
 * 订单类接口的版本（OrdersController）：连 `customer.platform` 一起清 —— 那个字段
 * 在订单里存的就是来源（小红书 / 抖音），订单列表那一格的兜底正是它。
 */
@Injectable()
export class CustomerSourceMaskInterceptor extends BaseCustomerSourceMaskInterceptor {
  protected readonly opts: StripSourceOptions = { platform: 'blank' };
}

/**
 * 客户档案接口的版本（CustomersController）：摘 `customFields` 里的来源 / 来源账号，
 * `customer.platform` 只清「不是联系方式平台」的取值（小红书 / 抖音 / 快手…）——
 * 这个字段在客户档案里还兼着「客户用的是微信 / QQ / 电话 / 其他」，
 * 一律清掉会让陪玩端把客户的 QQ / 电话显示成「未绑定」。
 */
@Injectable()
export class CustomerProfileSourceMaskInterceptor extends BaseCustomerSourceMaskInterceptor {
  protected readonly opts: StripSourceOptions = { platform: 'contactOnly' };
}
