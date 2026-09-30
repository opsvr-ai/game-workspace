/**
 * 装机 / 机器台账回传用的共享令牌。
 *
 * 只用来挡住误报、乱报，不是强认证（装机脚本本身就是公开可下载的），
 * 所以千万别拿它当「机密」。这里单独抽出来是因为 controller / service 都要用。
 */
export const ONBOARD_REPORT_TOKEN = 'c4f1a2e7d9b8435fa6e10c7d2b9f8e34';
