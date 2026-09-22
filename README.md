# Chunlv Esports -- Companion Dispatch Management System

> A full-lifecycle digital operations platform for esports companion studios, covering order taking, dispatching, billing, customer management, employee management, and profit/loss statistics with multi-studio / cross-studio collaboration.

---

## Recent Updates (v3.2.0)

- **客服端客户端 1.0.20260927 发布（2026-09-22）:** 客服端这次只攒了一条改动——版本号查询从 5 分钟放宽到 30 分钟（一天查 288 次没有意义；后台「推送更新」仍可立刻下发）。顺带把客服端的发布链路补成脚本：新增 `scripts\_publish_cs_client.py`（陪玩端早有 `_publish_client.py`，客服端以前只能手工传包 + 手工改库），流程一致，**版本号不递增会直接中止**（客户端只在服务端版本严格更新时才装）。线上已复核 `/api/agent/cs-version` 返回新版本、装机包可下载；客服电脑下次启动客户端自动升级，不动接单链路。同时清掉 `apps/` 根目录 424MB 没人引用的历史垃圾（旧 Electron 解包 + 两个 app.zip）。
- **桥接往来对账（2026-09-21）:** 桥接口径定死为「双方能互相抢单、人员互通」，系统**只统计、不自动转账**，钱由两个店长在微信上定期互相结。「工作室桥接」页新增**桥接往来（对账）**：算清「我店发的单被对方店陪玩接走 → 我应付对方店多少钱」和「对方店的单被我店陪玩接走 → 我应收多少钱」，金额 = 陪玩在该单的业绩 × 他**自己店**的分成比例（与月末发工资同一套算法，别处再算一份就会对不上账）。页面给应付 / 应收 / 净额三张卡 + 一家店一笔小账 + 完整明细，还能一键「复制明细（发微信）」。接口 `GET /api/bridges/settlement`。
- **店跟店相互独立（2026-09-21）:** 租赁线下工作室 / 线上俱乐部**店长可以改自己店里的任何数据**，配置默认全部归分店（只有「影响数据安全与稳定性」的才归老板：密钥 / 凭据，以及一份值绑住全站的开关与版本号）。配置分两层——店长保存只写 `StudioConfig`（本店覆盖），老板保存写 `SystemConfig`（全站默认），没填的项自动跟着老板的默认走。写入收口到唯一入口 `saveConfigsByRole`，读取全部走 `resolveConfigs*` 按店解析（钱、派单、截图、考勤、评分、报账预警、客户跟进阈值等 20 处）。店长「恢复默认」一键回到老板的值；老板能在设置页挑任意一家店查看 / 逐项恢复。密钥类的值连读都不给店长。
- **登录「too many request」根因修复（2026-09-21）:** 限流原来按公网 IP 记账，工作室几十台机器共用一个出口，一个人反复输错密码就能把整个工作室的登录额度占满（订单池轮询还被挤爆过 1365 次）。现在按「人」记账：登录/注册/找回密码按「账号 + 来访 IP」、带令牌的请求按「用户 id」，配额放宽到 15/秒、80/10 秒、600/分钟，被限流时提示「操作太频繁，请等 X 秒再试」，访问日志补上来访 IP（`apps/server/src/common/app-throttler.guard.ts`）。
- **聊天「已阅读 / 未读」回执（2026-09-21）:** 自己发出的消息气泡下面显示对方读没读——灰色「未读」，对方一打开会话就**实时**变绿色「已阅读」（新增 `chat:read` WebSocket 推送 + 消息列表 `peerReadSeq`）。群聊不做单条已读。
- **「动不动掉线」根因已修（2026-09-21）：** 客户端每 60 秒向服务端要一次「前端构建号」，以前下发的是**进程启动时间** —— 服务端每重启一次（每次发版都会重启），所有陪玩端下一轮心跳就整页刷新一次，看起来就是「掉线 / 闪一下重新加载」。现在构建号改成读 `apps/server/web-dist` 真实产物 hash（`assets/index-<hash>.js`），**只重启服务端不再触发任何客户端刷新**，只有真发了新前端才刷一次；客户端同时加了三道闸：服务中不刷、刚打开页面 120 秒内不刷、5 分钟最多刷一次（`apps/web/src/layouts/AppLayout.tsx`）；断开连接 60 秒宽限期内连回来算没掉线；部署脚本内容没变会自动跳过重启（`scripts\_deploy_server_cloud.py`）。
- **抢单改成「每日名额制」（老板 2026-09-20 拍板）:** 废掉「今日流水 ≥ 门槛才能抢单」的死循环规则（流水只能靠完成订单产生，门槛一恢复每天早上谁都抢不了第一单），改成按段位每天发 **上等马 3 / 中等马 2 / 下等马 1** 个「立即打」名额，**没用完自动累计**；预约单、客服指定单、陪玩自己发的单不占名额。名额「先扣、抢失败再退回」，并发下不会出现抢到单没扣名额。详见 `apps/server/src/orders/companion-quota.service.ts`。
- **抢单超时回收:** 线上 56 单卡在「已抢单」（其中一人囤 20 单、最早 5 天前），好单烂在手里别人没单可抢。现在抢单后 180 分钟没点「开始服务」且无任何服务记录 → 自动退回订单池，名额不退；发布已超过 24 小时的直接作废并通知客服。上线首轮清掉 52 张僵尸单、退回 2 张。
- **报账能补报了，时间口径只剩一种:** 全部统一为「每天中午 12:00 换日」（12 点前打的单/报的账算前一天）。新增 `GET /api/companions/me/reportable-sessions?day=YYYY-MM-DD`（补报指定营业日）与 `?unreported=1`（补最近 14 天漏报），已报过的场次不会重复出现；报账弹窗加了营业日选择器与「补报漏单」。
- **报账偏差落成待办:** 系统按真实计时算出应报金额，与上报金额差超过阈值时，除了弹窗，还会**写进报账单备注**（管理端一眼看到）并把相关场次**标红**。
- **管理端审核支取修好了:** 以前拿没人维护的 `Companion.balance` 卡审核，导致「余额不足，无法通过支取」，线上支取记录一直为 0。现在用统一口径现算可用额；**可支取余额 =（当月累计业绩 × 分润比例）− 当月已支取 − 当月待审 − 未打存单预留**，实现在 `apps/server/src/common/withdrawable.ts`。
- **聊天「加载更多」修好了:** 前端把消息时间戳当序号传后端、后端拿去查 32 位整型字段直接炸（线上 5 次 Unhandled exception），前端又吞掉错误 → 表现为「点了没反应」。现在前端传 `seq`，后端裁掉非法游标。同时重建线上 Prisma Client，修掉群聊创建一直报 `Unknown argument isGroup` 的问题。
- **新单弹窗更合理:** 弹窗秒数可配（`pool.popup_seconds`，线上 20 秒，原来写死 15）；「接单中 / 娱乐中」默认**不打扰**，想接新单的人可自己开开关（`/api/companions/me/notify-prefs`）；广播急单对自家工作室立即可见，不再排段位等 60/120 秒。
- **WebSocket 认证失败可定位:** 记录失败令牌里的用户名 / 角色 / 签发时间 / 来源 IP，并回 `auth:failed`；前端收到后用 refreshToken 换新令牌自动重连，不再拿着废令牌一直重连失败（那段时间收不到弹窗）。
- **WebSocket 弹窗断链的根修了:** accessToken 只有 15 分钟，客户端拿过期令牌重连会被服务端直接拒，那段时间一条弹窗都收不到。现在「本服务器签发、只是过期」的令牌按 `ws.token_grace_hours`（默认 7 天）放行连上（HTTP 接口仍严格校验过期），并推 `auth:stale_token` 提示客户端换新令牌；前端每 10 分钟静默续期、断线先换令牌再重连；陪玩端主进程被拒后也会换令牌重连。线上用真令牌实测：过期 1 小时的能连上，过期 10 天 / 别的密钥签的照样拒绝。
- **看板的接单率和娱乐费不再是假数:** 接单率改成「接单时长 ÷ 在线时长」（原来算的是忙碌人数占比的瞬时快照）；娱乐费统一走 `common/entertainment-fee.ts`（原来看板写死 1 元/分钟，且全系统四处算法各不相同）；结算总览也改成调同一份「可支取余额」实现，分润阶梯的代码默认值对齐线上 6000 档。

## Recent Updates (v3.1.0)

- **整站视觉改版:** 整页淡紫/淡青晕染底色 + 立体白卡、卡片标题带品牌渐变竖条、表头渐变与悬浮高亮、主按钮品牌紫渐变、标签胶囊化；**左侧导航按模块上色**并在选中项上用「发光胶囊 + 左侧光条」，顶栏加门店名胶囊；首页 KPI 卡统一成「白卡 + 左侧色条 + 同色数字」；分账规则页四行按 陪玩紫 / 店长蓝 / 客服橙 / 工作室绿 上色。只改渲染，不动结构与字号。

- **分账规则一页看全四个人:** 「设置 → 分账规则」改成从上到下 **陪玩 → 店长 → 客服 → 工作室** 四行，横向是流水档位。工作室那一栏灰底只读、自动算（= 100 − 陪玩 − 店长 − 客服），四个数加起来永远 100%，配不出「120%」。左侧栏「陪玩工资管理 / 客服财务管理 / 店长设置 / 客服设置」标题后面直接挂上比例小字（如 `70%`、`1%`），和设置页同一个数；左侧栏同时加宽到 216px，长标题不再被截断。

- **订单池新单固定在最上面:** 抢单池接口以前按发布时间升序返回，客服端派单工作台又没在前端排序，导致刚发布的单掉到列表最底部；现在接口统一倒序返回，派单工作台和订单池页再各自排一次。
- **订单池不再被挤到人员列表下面:** 派单工作台中间那一列的内容比列宽还宽时会被整体折行到下一行（「订单池」连订单一起掉到人员列表下方，看起来订单全在底部），现在这一列固定占右侧剩余宽度、订单信息在行内换行，右侧操作按钮不换行。
- **不再突然掉回登录页:** 两个客户端以前只要窗口里任何一次加载失败就会把整个窗口拉回登录页（子框架失败、偶发断网、部署新前端后旧资源 404 都会触发），现在只在登录页自身加载失败时才重试；网页端也只在服务端明确拒绝 refreshToken（4xx）时才清登录态，断网/超时不再把人踢出去。
- **桥接工作室可正常抢单（已核实）:** 光耀电竞与蠢驴电竞为 ACTIVE 桥接且 POOL 权限双向同意，光耀陪玩能在订单池看到蠢驴发布的单并成功抢单（桥接单延后 30 秒可见）。
- **人员列表列宽统一:** 客服端和店长端看同一个「人员」列表宽度不一样（客服端写死 240px、店长端写死 220px）的问题已修复，两端统一到同一份列宽常量并锁死宽度；长名字/长工作室名不再把整列顶宽，名字过长只在自己身上省略号截断。在 1080 的客服小窗口下也不再出现「王…」这种被截断的姓名。
- **群聊广播（催陪玩接单）:** 客服在工作室群聊里点「📢 广播」，本店所有在线陪玩的电脑右下角会弹出红色提醒窗口（置顶、不抢鼠标键盘、5 秒后自动消失），打游戏时也不会漏看；广播内容同时留在群聊里，并用红底「📢 群聊广播」样式单独标记。陪玩端客户端已更新到 1.0.20260919。
- **人员列表固定顺序:** 现在自上而下依次是 群聊 → 客服 → 店长 → 在线空闲陪玩 → 在线接单中陪玩 → 在线娱乐中陪玩 → 离线人员，客服和店长不再被埋在陪玩中间。
- **派单方式语义分开:** 「广播」= 本店所有在线空闲陪玩右下角弹窗抢单（订单同时进池）；「入池」= 只进抢单池、不弹窗；「指定」= 只弹给被指定的陪玩。修掉了「入池 + 立即」被当成急单弹给所有人、以及「指定 + 立即」把指定单泄漏给全店的问题。
- **发布订单「广播」修复:** 派单方式选「广播」原先会被服务端校验拦下并报错，现在可以正常发布；订单照常进池，同时立刻推送给工作室所有空闲陪玩。
- **左侧菜单仅文字可点:** 空白区域不再触发跳转，减少误触。
- **左侧导航滚动修复:** 菜单过长时只在左侧栏内部滚动，不会整页卡住。
- **独立群聊栏默认收起:** 群聊已并入人员列表，避免左侧多出一列，右上角可手动展开独立消息栏。
- **左侧栏固定独立滚动:** 左侧导航和消息栏保持固定，只有右侧内容区滚动，减少小窗口下整页滚动的不适感。
- **左侧菜单深色补底:** 修复展开子菜单后下方区域变白的问题，现在子菜单背景与侧栏整体深色一致。
- **群聊入口显示未读与最近消息:** 人员列表里的工作室群聊现在会显示未读数量和最新消息预览，有人 @ 自己时会带 @ 标识。
- **群聊入口随时可点:** 聊天窗口不再遮挡页面，聊天开着也能继续点左侧人员列表；群聊入口和点人一样统一切换到同一个聊天窗口，并自动清掉上一条会话的订单信息。
- **窗口偏好按账号记忆:** 陪玩端主窗口和聊天面板的尺寸/位置会按账号分开保存，换账号不串，重新登录同账号可恢复上次布局。
- **小窗口字体自适应:** 窗口宽度变小时自动缩小正文、卡片、表格和按钮字体，让陪玩端小窗口更紧凑易读。
- **小窗口自适应:** 陪玩端在较窄窗口下会自动收起消息栏并收紧内容边距，需要时可手动展开。
- **陪玩端新订单置顶:** 订单池按发单时间倒序展示，新发布的订单会出现在最上面，不用再滚到小窗口底部。
- **防止 BUSY 脏状态漏单:** 系统会自动清理没有进行中服务却仍显示接单中的陪玩，并自动结束超过 24 小时的异常进行中会话，让这些人不再错过新急单。
- **登录态失效自动回登录:** 陪玩端遇到 token 过期时会自动回登录页，若保存过账号密码会自动重新登录，避免客户端开着却因 401 无法上报心跳而显示离线。
- **人员列表显示全部人员:** 派单工作台/订单池左侧人员列表不再按心跳时间隐藏离线人员，所有人都能看到，在线/离线仅作状态标识。
- **超时订单只进客服流转失败明细:** 立即打超过 10 分钟、预约单超过 60 分钟仍无人接的订单，会从陪玩订单池隐藏并禁止抢单/快速抢单/直接指派，只保留在客服/管理端的“订单池流转失败明细”中处理。
- **聊天订单信息按入口显示:** 从订单点“沟通”进入聊天会显示订单信息；从人员列表进入聊天会清空并隐藏订单信息，避免旧订单上下文串到普通人员会话里。
- **群聊消息左侧常驻提示:** 工作室群聊的新消息不再从右上角铃铛弹出，而是在左侧常驻消息面板直接显示群聊未读角标和最新消息预览，点击即可打开群聊。
- **群聊右键 @ 成员:** 群聊消息显示发送者名字，右键名字可快速插入 `@名字`，发送后自动通知被 @ 的成员。
- **订单池发布后可修改:** 发布到订单池的订单支持发布者/店长/老板修改客户微信、房间码、来源账号、游戏、金额、预约时间等信息，未抢单或已抢单都会同步更新并实时刷新。
- **账号笔记计划表:** 工作室账号管理的小红书账号「笔记」抽屉新增「计划表」，可按账号关键词批量生成 7 天标题、正文、话题、封面构图和配图建议，并支持导入浏览器扩展采集的对标笔记先拆解爆款规律。
- **内容查重 + 违禁词检测:** 新增「内容查重风控」页面，发布小红书/抖音等笔记前可检测站外导流、诱导私信、低价营销、极限词等违禁词，并与当前文案、同批草稿、历史文案及系统已录笔记做重复度检查，支持启用大模型语义查重。
- **派单优先级与客服提成:** 订单区分线下/线上来源，立即打优先线下空闲且达标陪玩，客服提成支持比例+保底/固定金额，按营业月归属，并按收款微信每日对账
- **客服桌面客户端:** 新增轻量 Electron 客服端，支持语音与系统通知，无陪玩端管控限制
- **客户追踪与抢单门槛:** 每日有效客户名额、联系结果登记、三档可配置门槛、客户追踪/提醒/删除审核、管理端追踪中心与陪玩端追踪面板、客户 KPI 与异常检测
- **通知设置:** 系统设置新增「通知设置」，可配置声音、桌面与角标提醒
- **考勤设置:** 系统设置新增「考勤设置」，可配置陪玩每日上下班时间，用于迟到/早退判定
- **陪玩服务证据链增强:** 开始服务必填游戏模式/单价/实际时长/转账截图；结束服务长图含「财务核对卡」+「AI 异常分析卡」，转账低于审核金额黄标、0 截图红标，并按时长校验截图数量
- **支出/支取审核:** 财务管理新增「支出/支取审核」页，分 tab 审核陪玩支出/支取申请与钱包流水，支持月度汇总与通过/驳回
- **客服/店长提成复核:** 提成结算列表支持逐条「确认/撤销」锁定发放口径
- **截图阈值配置化:** 系统设置新增「截图阈值」，可配置截图间隔/黑屏判定/每小时期望张数与合格率，客户端动态拉取用于服务留痕标黄/红
- **客服派单/提成核对:** 「每日统计」页升级为可筛选的客服发单/提成核对工作台，展示发单客服、认领客服、工作微信、客户付款去向与陪玩费状态
- **进程黑名单管理:** 陪玩终端进程采集上报, 黑/白名单 CRUD, 双模式添加(多选+手动), 推送下发, 5秒倒计时杀进程通知, REST/WS 双通道, 全链路日志
- **远程控制增强:** 陪玩姓名搜索+状态筛选, 30s自动刷新, 按钮在线判断优化
- **陪玩客户端与看门狗稳定性:** 看门狗非阻塞重启, 更新失败保护, 退出登录断连, 锁屏安全加固, 30s 心跳对齐,
  误杀保护（发现机器上已有存活的客户端就接管、不再杀掉重拉）, 更新后 exe 丢失自愈, 服务自更新
- **客服自抢单/线索养客:** 客服可认领暂时不玩的池子订单到工作微信，客户要打时一键放回抢单池并标记立即打；订单记录收款去向，便于核对客服提成与资金流
- **陪玩端安全记住密码 + 重启自动恢复登录:** Electron 客户端支持记住账号密码，使用操作系统安全存储加密凭据，并限制仅受信任服务端页面可读取；客户端重启（崩溃自愈 / 更新 / 开机）后会自动恢复登录——先用主进程里 7 天有效的令牌，令牌彻底失效才回退到记住的账号密码，「退出账号」仍会清掉两者
- **财务对账与防私单:** 价格规则配置、客服/店长提成结算、月度分成快照、每日到账对账、客户画像与 AI 私单风险工作台，统一金额整数分与营业日 12 点边界
- **服务结束财务审核:** 陪玩结束服务时填写客户实际转账合计，系统自动与「填写时长 × 单价」核对，低于审核金额标红、留空待核对
- **报账金额协商:** 管理端改价发起协商，陪玩端接受/拒绝；客服可参与报账审核

## Recent Updates (v3.0.0)

- **Unified Dashboard:** 昨日/全月总流水, 31天趋势图, 订单类型饼图, 陪玩收入排行, 点击陪玩查看明细
- **Performance Dashboard:** 每日/全月绩效排行（接单率/续单率/复购率/流水结构分析）
- **Companion Wallet:** 押金/余额/冻结/可支取 + 支取申请/审核流程
- **Monthly Settlement:** 阶梯分成自动结算（三段阶梯：50%/60%/70%）
- **Customer Profiles:** 19字段画像 + 自定义备注 + 跟进记录
- **Customer Intelligence:** 首单/复购自动检测, 活跃/待跟进/流失状态判定
- **AI Analysis:** 消费力/忠诚度/活跃度评分 + 维护建议 + 话术生成
- **Enhanced Service Settlement:** 首单+续单结算, 自动创建续单子订单
- **Dual Companion Flow:** 呼叫搭档/接受搭档 WebSocket 通知
- **Traffic Pool:** 渠道管理（小红书/抖音/快手/转介绍）+ 统计
- **Companion Resignation:** 一键离职处理（清数据/释工位/释微信）
- **Tenant Authorization:** 租客→客服权限范围管理
- **Work WeChat Management:** 工作微信绑定/解绑/自动释放
- **Unified Order Pool:** 全角色统一横向卡片 + 沟通按钮 + 抢单弹窗+复制微信
- **System Config:** 16项全局配置（流水门槛/阶梯分成/支取比例/超时/下拉选项）
- **7 new models:** StudioDailyStats, ExpenseReport, WalletTransaction, CustomerProfile, CustomerFollowUp, TenantAuthorization, WorkWechat

---

## Table of Contents

- [Project Overview](#project-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [WebSocket Events](#websocket-events)
- [User Roles and Permissions](#user-roles-and-permissions)
- [Security](#security)
- [Environment Variables](#environment-variables)
- [Documents](#documents)

---

## Project Overview

The system serves companion studios with distinct interfaces for each role:

| Role | Interface | Primary Functions |
|------|-----------|-------------------|
| **Owner** | Web Browser | Studio management, employee management, revenue statistics, user authorization |
| **Admin** | Web Browser | Order dispatch, customer CRUD, billing review, PC remote control, revenue dashboard |
| **CS** | Web Browser | Dispatch workbench, order list, companion status monitoring |
| **Companion** | Go Desktop Agent | Accept orders, report billing, track work time, receive remote commands |

### Architecture

```
Browser (React SPA) ──HTTP──▶ Nest.js (Express) ──▶ PostgreSQL 16 + Redis 7
```

### Screenshots

> _Screenshots placeholder -- add screenshots of the dispatch workbench, revenue dashboard, billing review, and agent local UI here._

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React + TypeScript | 18.3 |
| | Ant Design (UI library) | 5.18 |
| | Zustand (state management) | 5.0 |
| | React Router (routing) | 6.23 |
| | Recharts (charts) | 3.9 |
| | Vite (build tool) | 6.0 |
| | Axios (HTTP client) | 1.7 |
| **Backend** | Nest.js (Node.js framework) | 10.3 |
| | Express (HTTP platform) | 10.3 |
| | Prisma ORM | 5.14 |
| | Socket.IO (WebSocket) | 4.8 |
| | Passport + JWT (auth) | 0.7 / 10.2 |
| | bcryptjs (password hashing) | 2.4 |
| | class-validator (validation) | 0.14 |
| **Database** | PostgreSQL | 16 (Alpine) |
| **Cache** | Redis | 7 (Alpine) |
| **Infra** | Docker Compose | -- |
| | pnpm Workspaces (monorepo) | 8+ |
| **Shared** | TypeScript (types + enums) | 5.5 |

---

## Project Structure

```
chunlv-esports/
├── apps/
│   ├── web/                          # React frontend (management & CS portal)
│   │   └── src/
│   │       ├── api/                  # Axios API client
│   │       ├── layouts/             # AppLayout with role-based navigation
│   │       ├── stores/              # Zustand state stores
│   │       ├── pages/
│   │       │   ├── LoginPage.tsx
│   │       │   ├── ContentCheckPage.tsx # 内容查重 + 违禁词检测
│   │       │   ├── owner/           # Owner pages (5 pages)
│   │       │   │   ├── AuthorizationsPage.tsx
│   │       │   │   ├── CustomersPage.tsx
│   │       │   │   ├── EmployeesPage.tsx
│   │       │   │   ├── RevenuePage.tsx
│   │       │   │   └── StudiosPage.tsx
│   │       │   ├── admin/           # Admin pages (6 pages)
│   │       │   │   ├── BillingPage.tsx
│   │       │   │   ├── CompanionsPage.tsx
│   │       │   │   ├── CustomersPage.tsx
│   │       │   │   ├── DispatchPage.tsx
│   │       │   │   ├── PcControlPage.tsx
│   │       │   │   └── RevenuePage.tsx
│   │       │   └── cs/              # CS pages (3 pages)
│   │       │       ├── CompanionsStatusPage.tsx
│   │       │       ├── DispatchPage.tsx
│   │       │       └── OrdersPage.tsx
│   │       │   └── finance/         # Finance pages (5 pages)
│   │       │       ├── PriceRulesPage.tsx
│   │       │       ├── CommissionPage.tsx
│   │       │       ├── SettlementPage.tsx
│   │       │       ├── ReconciliationPage.tsx
│   │       │       └── RiskWorkbenchPage.tsx
│   │       └── router.tsx           # 14 frontend routes
│   │
│   ├── server/                       # Nest.js backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # 11 models (User, Studio, Companion, Order, etc.)
│   │   │   ├── seed.ts              # Test data seeding
│   │   │   └── migrations/          # Prisma migration history
│   │   └── src/
│   │       ├── app.module.ts        # Root module (imports all feature modules)
│   │       ├── main.ts              # Bootstrap: CORS, validation, static files, prefix
│   │       ├── auth/
│   │       │   ├── auth.controller.ts   # Login, refresh, verify-2nd, authorize, me
│   │       │   ├── auth.service.ts      # JWT dual-token + second password logic
│   │       │   ├── jwt.strategy.ts      # JWT passport strategy
│   │       │   ├── roles.guard.ts       # RBAC guard (OWNER/ADMIN/CS/COMPANION)
│   │       │   └── dto/login.dto.ts     # Login, Refresh, VerifySecond DTOs
│   │       ├── orders/
│   │       │   ├── orders.controller.ts # Create, pool, list, grab, assign, confirm, complete, cancel
│   │       │   ├── orders.service.ts    # Order lifecycle with data isolation
│   │       │   └── dto/
│   │       ├── companions/
│   │       │   ├── companions.controller.ts  # List, ranking, detail, status, revenue, command
│   │       │   └── companions.service.ts
│   │       ├── customers/
│   │       │   ├── customers.controller.ts   # CRUD + reassign + order history
│   │       │   └── customers.service.ts      # Data isolation by role
│   │       ├── content-check/
│   │       │   ├── content-check.controller.ts  # 违禁词词库 + 内容检查
│   │       │   ├── content-check.service.ts     # 词库匹配 + 滑动分片查重
│   │       │   └── content-check.lexicon.ts     # 2026 小红书风险词库
│   │       ├── billing/
│   │       │   ├── billing.controller.ts     # Transactions CRUD, approve, reject, batch, revenue, expenses
│   │       │   ├── billing.service.ts        # Revenue aggregation + profit/loss
│   │       │   ├── upload.controller.ts      # Screenshot upload (multer)
│   │       │   └── dto/create-transaction.dto.ts
│   │       ├── studios/
│   │       │   ├── studios.controller.ts     # Studio CRUD + employee management
│   │       │   └── studios.service.ts
│   │       ├── health/
│   │       │   ├── health.controller.ts      # /api/health -- DB connectivity check
│   │       │   └── health.module.ts
│   │       ├── ws/
│   │       │   ├── ws.gateway.ts             # Socket.IO gateway (connection lifecycle + events)
│   │       │   └── ws.module.ts
│   │       ├── prisma/
│   │       │   ├── prisma.module.ts          # Global PrismaService
│   │       │   └── prisma.service.ts
│   │       └── common/
│   │           └── http-exception.filter.ts  # Global exception filter
│   │
│   └── companion-electron/            # Electron desktop app for companions
├── packages/shared/                  # Shared TypeScript package
│   └── src/
│       ├── enums.ts                 # 7 enums (UserRole, OrderType, OrderStatus, DispatchType,
│       │                             #          CompanionStatus, PCMode, TransactionStatus)
│       ├── types.ts                 # 5 interfaces (ApiResponse, PaginatedResponse, Login*, UserInfo)
│       └── index.ts
│
├── docker/
│   ├── docker-compose.yaml          # PostgreSQL 16 + Redis 7
│   └── data/                        # Mounted data volumes
│
├── uploads/
│   └── screenshots/                 # Uploaded billing screenshots (served as static files)
│
├── docs/                            # Requirements, design docs, implementation plans
├── scripts/                         # 发版/运维链路脚本（见 scripts/README.md；一次性脚本不入库）
├── pnpm-workspace.yaml
├── package.json                     # Root workspace scripts
├── CHANGELOG.md
└── CLAUDE.md
```

---

## Quick Start

### Prerequisites

| Tool | Minimum Version | Required For |
|------|----------------|--------------|
| Node.js | >= 18 | Backend + Frontend |
| pnpm | >= 8 | Package management |
| Docker Desktop | Any recent | PostgreSQL + Redis |

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Start Infrastructure (PostgreSQL + Redis)

```bash
cp docker/.env.example docker/.env
# 编辑 docker/.env，设置 POSTGRES_PASSWORD 和 REDIS_PASSWORD
docker compose -f docker/docker-compose.yaml up -d
```

This starts:
- **PostgreSQL 16** on port `5432` (user: `postgres`, password: from `docker/.env`, database: `chunlv`)
- **Redis 7** on port `6379` (password: from `docker/.env`)

PostgreSQL and Redis only listen on `127.0.0.1` by default.

### 3. Initialize Database

```bash
pnpm db:migrate    # Apply Prisma migrations
pnpm db:seed       # Seed test data (default accounts)
```

### 4. Start Development Servers

```bash
# Terminal 1: Backend API server (http://localhost:3001)
pnpm dev:server

# Terminal 2: Frontend dev server (http://localhost:5173)
pnpm dev:web
```

### 5. Login

Open `http://localhost:5173` in a browser.

| Username | Password | Role | Notes |
|----------|----------|------|-------|
| `hanlei` | `123456` | OWNER | Full access; second password: `888888` |
| `kefu01` | `123456` | CS | Requires owner authorization |
| `zhangsan` | `123456` | COMPANION | Requires owner authorization |
| `peiwang01` | `123456` | COMPANION | Requires owner authorization |

### 6. Build for Production

```bash
pnpm build
# Output:
#   packages/shared/dist/
#   apps/server/dist/
#   apps/web/dist/
```

---

## Deployment (Auto)

服务器端已启用自动部署：每分钟检查 `master` 更新，检测到变更后自动安装依赖、构建前后端、执行 Prisma 迁移并重建应用容器。

- 部署脚本: `deploy/chunlv-deploy.sh`
- systemd 单元: `deploy/chunlv-deploy.service` + `deploy/chunlv-deploy.timer`
- 日志: `/var/log/chunlv-deploy.log`

## API Reference

All endpoints are prefixed with `/api`. The global prefix is set in `main.ts` via `app.setGlobalPrefix('api')`.

### Response Format

Every endpoint returns a standard JSON envelope:

```json
{
  "code": 200,
  "message": "ok",
  "data": { ... }
}
```

### Authentication

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `POST` | `/api/auth/login` | None | -- | Login. Body: `{ username, password }`. Returns `accessToken`, `refreshToken`, `user`. |
| `POST` | `/api/auth/refresh` | None | -- | Refresh tokens. Body: `{ refreshToken }`. Returns new token pair. |
| `POST` | `/api/auth/verify-2nd` | JWT | -- | Verify second password. Body: `{ password }`. Returns `secondToken` (5 min expiry). |
| `GET` | `/api/auth/me` | JWT | -- | Get current user info from token. |
| `PUT` | `/api/auth/me` | JWT | -- | Update current user displayName. Body: `{ displayName }`. |
| `PUT` | `/api/auth/users/:id/authorize` | JWT | OWNER | Authorize a user account (required for CS/COMPANION roles). |

### Content Check

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/content-check/lexicon` | JWT | OWNER, ADMIN, CS, COMPANION | Get the current content risk lexicon and version. |
| `POST` | `/api/content-check/check` | JWT | OWNER, ADMIN, CS, COMPANION | Check title/body/tags for banned words and duplicate similarity. |

### Orders

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `POST` | `/api/orders` | JWT | CS, ADMIN | Create a new order. Body: `CreateOrderDto`. |
| `PUT` | `/api/orders/:id` | JWT | CS, ADMIN, OWNER, COMPANION | Update a published order (publisher or privileged role). Body includes order info fields such as customer WeChat/room code. |
| `GET` | `/api/orders/pool` | JWT | -- | Get the dispatch pool (PENDING orders). |
| `GET` | `/api/orders` | JWT | CS, ADMIN, COMPANION | List orders. Query: `?status=PENDING\|GRABBED\|CONFIRMED\|DONE\|CANCELLED`. Data isolation applied. |
| `POST` | `/api/orders/:id/grab` | JWT | COMPANION | Grab an order from the pool. |
| `POST` | `/api/orders/:id/claim` | JWT | CS, ADMIN, OWNER | CS claims a lead order to a work WeChat account. Body: `{ workWechatId, workWechatName }`. |
| `POST` | `/api/orders/:id/release` | JWT | CS, ADMIN, OWNER | Return a claimed order to the pool and mark it urgent. Body: `{ urgency }`. |
| `POST` | `/api/orders/:id/assign` | JWT | CS, ADMIN | Directly assign order to a companion. Body: `{ companionId }`. |
| `POST` | `/api/orders/:id/confirm` | JWT | COMPANION | Confirm a grabbed order (start service). |
| `POST` | `/api/orders/:id/complete` | JWT | CS, ADMIN, COMPANION | Mark order as completed. |
| `POST` | `/api/orders/:id/cancel` | JWT | CS, ADMIN | Cancel an order. |

**Order Status Flow:** `PENDING` -> `GRABBED` -> `CONFIRMED` -> `DONE`; `PENDING` <-> `CLAIMED` for CS lead handling (or `CANCELLED` at any point)

| `POST` | `/api/orders/:id/complete-billing` | JWT | COMPANION | Complete order with billing detail. |
| `POST` | `/api/orders/:id/call-partner` | JWT | COMPANION | Call partner for dual companion order. |
| `POST` | `/api/orders/:id/accept-partner` | JWT | COMPANION | Accept partner invitation. |
| `GET` | `/api/orders/pool/status` | JWT | COMPANION | 抢单名额状态：`{ tier, dailyLimit, usedToday, remaining }`（旧的「流水门槛」已废弃）。 |

### Dashboard

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/dashboard` | JWT | ADMIN, OWNER | Dashboard overview (today stats, ranking, alerts). |
| `GET` | `/api/dashboard/trend` | JWT | ADMIN, OWNER | N-day revenue trend. Query: `?days=7`. |
| `GET` | `/api/dashboard/companions` | JWT | ADMIN, OWNER | Companion status list. |
| `GET` | `/api/dashboard/revenue-overview` | JWT | ADMIN, OWNER | Yesterday/monthly revenue + type breakdown + companion ranking. |
| `GET` | `/api/dashboard/companion-revenue/:id` | JWT | ADMIN, OWNER | Single companion revenue detail. |
| `GET` | `/api/dashboard/performance/daily` | JWT | ADMIN, OWNER | Daily KPI rankings. |
| `GET` | `/api/dashboard/performance/monthly` | JWT | ADMIN, OWNER | Monthly KPI rankings. |

### Config

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/config` | JWT | -- | Get the **effective** config for the caller's studio (store override → owner global → code default). Query: `?keys=a,b`; owners may add `?studioId=...` to inspect another store. Returns `_meta` with `overridden` / `studioScopedKeys`. |
| `PUT` | `/api/config` | JWT | ADMIN, OWNER | OWNER writes the global default; ADMIN writes **this studio's override only** (non-studio-scoped keys are skipped and reported in `data.skipped`). |
| `DELETE` | `/api/config/studio-overrides` | JWT | ADMIN, OWNER | Drop this studio's overrides so it falls back to the owner default. Query: `?keys=a,b` (omit to reset all); owners may pass `?studioId=...`. |

### Companions (报账 / 通知偏好)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/companions/me/today-sessions` | JWT | COMPANION | 当前营业日（12:00 换日）已完成场次。可选 `?day=YYYY-MM-DD`。 |
| `GET` | `/api/companions/me/reportable-sessions` | JWT | COMPANION | 报账取数：默认当前营业日，`?day=` 补报某天，`?unreported=1` 取最近 14 天漏报（含 `reported` 标记）。 |
| `GET` | `/api/companions/me/notify-prefs` | JWT | COMPANION | 读取「打单/娱乐中也接新单弹窗」偏好。 |
| `PUT` | `/api/companions/me/notify-prefs` | JWT | COMPANION | 设置该偏好。Body: `{ notifyWhileBusy: boolean }`。 |

### Expense Reports

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `POST` | `/api/expense-reports` | JWT | COMPANION | Submit expense/withdraw report. |
| `GET` | `/api/expense-reports` | JWT | -- | List reports (role-filtered). |
| `PUT` | `/api/expense-reports/:id/review` | JWT | ADMIN, OWNER | Review (approve/reject). |
| `GET` | `/api/expense-reports/monthly-summary` | JWT | ADMIN, OWNER | Monthly summary stats. |

### Wallet & Settlement

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/companions/me/wallet` | JWT | COMPANION | Get wallet balance. |
| `POST` | `/api/companions/me/withdraw` | JWT | COMPANION | Request withdrawal. |
| `GET` | `/api/wallet-transactions` | JWT | ADMIN, OWNER | List wallet transactions. |
| `PUT` | `/api/wallet-transactions/:id/review` | JWT | ADMIN, OWNER | Review wallet transaction. |
| `POST` | `/api/monthly-settlement` | JWT | ADMIN, OWNER | Run monthly settlement. |
| `GET` | `/api/monthly-settlement` | JWT | ADMIN, OWNER | Get settlement history. |

### Finance

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/finance/price-rules` | JWT | ADMIN, OWNER, CS | List studio price rules. |
| `POST` | `/api/finance/price-rules` | JWT | ADMIN, OWNER | Create price rule (floor/max price in yuan). |
| `PATCH` | `/api/finance/price-rules/:id` | JWT | ADMIN, OWNER | Update price rule. |
| `GET` | `/api/finance/price-rules/builtin` | JWT | ADMIN, OWNER, CS | Builtin mode price rules (机密/绝密). |
| `POST` | `/api/finance/settlement/:month` | JWT | ADMIN, OWNER | Run monthly share settlement (immutable snapshot). |
| `GET` | `/api/finance/settlement/:month` | JWT | ADMIN, OWNER, CS | List settlement snapshot for month. |
| `GET` | `/api/finance/commission/rules` | JWT | ADMIN, OWNER, CS | List commission rules. |
| `POST` | `/api/finance/commission/rules` | JWT | ADMIN, OWNER | Create/update commission rule. |
| `POST` | `/api/finance/commission/calculate/:month` | JWT | ADMIN, OWNER | Calculate monthly commission (idempotent). |
| `GET` | `/api/finance/commission/:month` | JWT | ADMIN, OWNER, CS | List commission ledgers for month. |
| `GET` | `/api/finance/reconciliation?day=YYYY-MM-DD` | JWT | ADMIN, OWNER, CS | Daily arrival reconciliation per companion. |
| `GET` | `/api/finance/risk-queue` | JWT | ADMIN, OWNER, CS | Customer analytics + private-order risk queue. |

### Customer Profiles & AI

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/customers/:id/profile` | JWT | -- | Get/auto-create customer profile. |
| `PUT` | `/api/customers/:id/profile` | JWT | ADMIN, OWNER, COMPANION | Update profile. |
| `GET` | `/api/customers/:id/type` | JWT | -- | Detect customer type (first/repeat). |
| `GET` | `/api/customers/:id/follow-ups` | JWT | -- | List follow-up records. |
| `POST` | `/api/customers/:id/follow-ups` | JWT | ADMIN, OWNER, COMPANION | Add follow-up. |
| `GET` | `/api/customers/traffic/pool` | JWT | ADMIN, OWNER | Traffic pool (channel data). |
| `GET` | `/api/customers/traffic/stats` | JWT | ADMIN, OWNER | Channel statistics. |
| `POST` | `/api/ai/analyze/:customerId` | JWT | ADMIN, OWNER, COMPANION | AI customer analysis. |

### Work Wechat

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/companions/work-wechats` | JWT | ADMIN, OWNER | List work wechats. |
| `POST` | `/api/companions/work-wechats` | JWT | ADMIN, OWNER | Add work wechat. |
| `PUT` | `/api/companions/work-wechats/:id/bind` | JWT | ADMIN, OWNER | Bind to companion. |
| `PUT` | `/api/companions/work-wechats/:id/unbind` | JWT | ADMIN, OWNER | Unbind wechat. |
| `GET` | `/api/companions/chat-history/:companionId` | JWT | -- | Get full chat history with a companion. |
| `GET` | `/api/companions/chat-pending` | JWT | -- | Get pending chat messages for current studio. |
| `POST` | `/api/companions/chat-notify` | JWT | COMPANION, CS, ADMIN, OWNER | Send chat notification from companion. |

### Customers

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/customers` | JWT | -- | List customers (data isolation by role). |
| `GET` | `/api/customers/:id` | JWT | -- | Get customer detail. |
| `POST` | `/api/customers` | JWT | ADMIN, OWNER, CS | Create a new customer. |
| `PUT` | `/api/customers/:id` | JWT | ADMIN, OWNER | Update customer fields. |
| `DELETE` | `/api/customers/:id` | JWT | ADMIN, OWNER | Delete a customer. |
| `GET` | `/api/customers/:id/orders` | JWT | -- | Get order history for a customer. |
| `PUT` | `/api/customers/:id/reassign` | JWT | ADMIN, OWNER | Reassign customer to a different companion (or unassign). Body: `{ companionId }`. |

### Companions

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/companions` | JWT | -- | List companions with online status (data isolation). |
| `GET` | `/api/companions/ranking` | JWT | -- | Get revenue ranking of companions. |
| `GET` | `/api/companions/:id` | JWT | -- | Get companion detail. |
| `PUT` | `/api/companions/:id/status` | JWT | COMPANION | Update companion online status (`ONLINE`, `BUSY`, `IDLE`, `OFFLINE`). |
| `GET` | `/api/companions/:id/revenue` | JWT | -- | Get revenue breakdown for a specific companion. |
| `POST` | `/api/companions/:id/command` | JWT | ADMIN, OWNER | Send a remote command to companion's PC via WebSocket. Body: `{ command, params? }`. |
| `POST` | `/api/companions/:id/kick` | JWT | ADMIN, OWNER | Kick a companion offline (disconnect WebSocket + mark OFFLINE). |
| `POST` | `/api/companions/agent-heartbeat` | JWT | COMPANION | Agent REST heartbeat. Body: `{ mode, workSec, entertainSec, totalSec }`. |

### Billing -- Transactions

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `POST` | `/api/transactions` | JWT | COMPANION | Submit a billing transaction (expense report). |
| `GET` | `/api/transactions` | JWT | ADMIN, OWNER, CS, COMPANION | List transactions. Query: `?status=PENDING\|APPROVED\|REJECTED\|NEGOTIATING`. |
| `PUT` | `/api/transactions/:id/approve` | JWT | ADMIN, OWNER, CS | Approve a transaction. |
| `PUT` | `/api/transactions/:id/reject` | JWT | ADMIN, OWNER, CS | Reject a transaction. |
| `PUT` | `/api/transactions/:id/propose` | JWT | ADMIN, OWNER, CS | Propose an adjusted amount. Body: `{ amount, note? }`. |
| `PUT` | `/api/transactions/:id/accept-proposal` | JWT | COMPANION | Accept the proposed adjustment. |
| `PUT` | `/api/transactions/:id/reject-proposal` | JWT | COMPANION | Reject the proposed adjustment. |
| `PUT` | `/api/transactions/batch` | JWT | ADMIN, OWNER, CS | Batch approve or reject. Body: `{ ids: string[], action: "approve" \| "reject" }`. |

### Billing -- Revenue

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/revenue/daily` | JWT | -- | Get daily revenue breakdown by order type. Query: `?date=YYYY-MM-DD`. |
| `GET` | `/api/revenue/monthly` | JWT | -- | Get monthly revenue with per-companion ranking. Query: `?month=YYYY-MM`. |
| `GET` | `/api/revenue/stats` | JWT | OWNER | Get profit/loss statistics. **Requires header:** `X-Second-Token: <secondToken>`. |
| `GET` | `/api/revenue/daily/csv` | JWT | -- | Download daily revenue as CSV. Query: `?date=YYYY-MM-DD`. |
| `GET` | `/api/revenue/monthly/csv` | JWT | -- | Download monthly revenue as CSV. Query: `?month=YYYY-MM`. |

### Billing -- Expenses

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/expenses` | JWT | -- | List expenses for the studio. |
| `POST` | `/api/expenses` | JWT | ADMIN, OWNER | Create an expense record. |

### Studios

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/studios` | JWT | OWNER | List all studios. |
| `POST` | `/api/studios` | JWT | OWNER | Create a new studio. Body: `{ name }`. |
| `PUT` | `/api/studios/:id` | JWT | OWNER | Update studio name. Body: `{ name }`. |

### Bridge (工作室桥接)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/bridges` | JWT | ADMIN | 本店的活跃桥接 + 待处理申请。 |
| `GET` | `/api/bridges/active` | JWT | -- | 本店所有生效中的桥接。 |
| `POST` | `/api/bridges/propose` | JWT | ADMIN | 发起桥接申请。Body: `{ targetStudioId }`。 |
| `POST` | `/api/bridges/:id/respond` | JWT | ADMIN | 同意 / 拒绝并选共享内容。Body: `{ accept, functionFilter }`。 |
| `PUT` | `/api/bridges/:id/permissions` | JWT | ADMIN | 改我方共享给对方的内容。Body: `{ functions }`。 |
| `DELETE` | `/api/bridges/:id` | JWT | ADMIN | 断开桥接。 |
| `GET` | `/api/bridges/settlement` | JWT | ADMIN, OWNER | **桥接往来对账（只统计，不转账）**：谁接了我店的单该给对方多少钱、对方陪我店多少单该收多少钱。Query: `?month=YYYY-MM`（营业月，12:00 换日）、`?peerStudioId=`；老板可加 `?studioId=` 看任意一家店。返回 `rows`（逐单明细）/ `peers`（一家店一笔小账）/ `totals`（`payable` / `receivable` / `net`）。 |

### Employees

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/employees` | JWT | OWNER, ADMIN | List employees. Query: `?studioId=...`. |
| `POST` | `/api/employees` | JWT | OWNER, ADMIN | Create a new employee. Body: `{ username, password, role, studioId }`. |
| `PUT` | `/api/employees/:id/password` | JWT | OWNER, ADMIN | Reset employee password. Body: `{ password }`. |
| `DELETE` | `/api/employees/:id` | JWT | OWNER, ADMIN | Delete an employee (soft-delete: sets deletedAt). |

### Upload

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `POST` | `/api/upload/screenshot` | JWT | COMPANION | Upload a billing screenshot. Multipart form: `file` (JPG/PNG/WebP, max 5 MB). |

### Agent (客户端装机 / 更新)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/agent/version` | None | -- | Latest companion client version + download URL (client polls this). |
| `GET` | `/api/agent/download/exe` | None | -- | Full NSIS installer download (`陪玩管理-Setup.exe`). |
| `GET` | `/api/agent/download/latest` | None | -- | Latest unpacked zip for self-update. |
| `POST` | `/api/agent/onboard-report` | `x-onboard-token` header | -- | A freshly onboarded PC reports hostname / IP / MAC / client version and the remote-support account it just generated. Appended to `onboard-reports/machines.jsonl` (repo root, not web-served). |
| `POST` | `/api/agent/client-error` | None | `{phase,url,status,message,detail}` | 前端上报「请求根本没到服务器」的网络层故障（注册失败、断网 / 被杀毒软件拦截等）。Appended to `client-errors/client-errors-<date>.jsonl` (repo root, not web-served). |
| `GET` | `/api/agent/update/queue` | JWT (ADMIN/OWNER/CS) | -- | 更新队列状态：谁在下载、下载了多久、几台在排队。发布时用来盯「铺开到哪台了」。 |

### Health

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/health` | None | -- | Health check. Returns `{ status, db, timestamp }`. |

---

## WebSocket Events

### Connection

- **URL:** `http://localhost:3001/socket.io/?EIO=4&transport=websocket&token=<JWT>`
- **Auth:** JWT token passed as query parameter `token`
- **Rooms (auto-join):** `studio:<studioId>`, `companion:<companionId>`, `pc:<companionId>`
- **On connect:** Companion marked `ONLINE` in DB, `status:broadcast` emitted to studio
- **On disconnect:** Companion marked `OFFLINE`, `status:broadcast` emitted

### Inbound Events (Agent/Client -> Server)

| Event | Payload | Description |
|-------|---------|-------------|
| `companion:status` | `{ status: string, mode?: string }` | Companion changes their status. Broadcasts to studio room. |
| `companion:heartbeat` | `{ mode, workSec, entertainSec, totalSec, timestamp }` | Periodic heartbeat (every 30 s). Updates `CompanionPC` record, creates `CompanionTimeLog` entries. |
| `pc:command_ack` | `{ command: string, success: boolean }` | Acknowledge execution of a remote command. Logged to `PCOperationLog`. |

### Outbound Events (Server -> Agent/Client)

| Event | Payload | Description |
|-------|---------|-------------|
| `pc:command` | `{ command: string, params?: object }` | Remote command sent to companion PC (`shutdown`, `restart`, `throttle`, `unthrottle`). |
| `order:new` | `{ id, type, amount, gameName, ... }` | New order pushed to a specific companion. |
| `status:broadcast` | `{ companionId, status, mode? }` | Broadcast companion status change to all users in the studio room. |
| `chat:read` | `{ roomId, readerId, readSeq }` | 已读回执：对方打开会话、把消息标成已读时推给**发消息的那一方**，前端把该条消息下的「未读」改成绿色「已阅读」。群聊不推。 |
| `chat:broadcast` | `{ roomId, messageId, senderId, senderName, senderRole, content, createdAt }` | 群聊广播：客服/店长在工作室群聊发广播时推给本工作室全体在线陪玩，陪玩端右下角弹 Windows 提醒（5 秒后消失）。 |

### Chat

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/chat/studio-group` | JWT | -- | 取（或创建）当前工作室群聊房间，并把当前用户加进群。 |
| `POST` | `/api/chat/studio-broadcast` | JWT | CS, ADMIN, OWNER | 群聊广播：内容落进工作室群聊（`type=BROADCAST`），同时向本工作室推送 `chat:broadcast`，陪玩端右下角弹提醒。Body: `{ content }`（200 字以内）。 |

### Command Types

| Command | Parameter | Description |
|---------|-----------|-------------|
| `shutdown` | -- | Shut down the companion PC. |
| `restart` | -- | Restart the companion PC. |
| `throttle` | `{ limitKB: number }` | Apply network bandwidth limit (KB/s). |
| `unthrottle` | -- | Remove network bandwidth limit. |
| `kick` | -- | Force disconnect companion from WebSocket and mark offline. |

---

## User Roles and Permissions

### Role Definitions

| Role | DB Value | Interface | Default Authorization |
|------|----------|-----------|----------------------|
| **Owner** | `OWNER` | Web Browser | Auto-authorized |
| **Admin** | `ADMIN` | Web Browser | Auto-authorized |
| **CS** | `CS` | Web Browser | Requires owner approval |
| **Companion** | `COMPANION` | Electron Desktop App | Requires owner approval |

### Permission Matrix

| Feature | OWNER | ADMIN | CS | COMPANION |
|---------|-------|-------|----|-----------|
| **Auth** | | | | |
| Login / Refresh / Me | Yes | Yes | Yes | Yes |
| Verify second password | Yes | -- | -- | -- |
| Authorize users | Yes | -- | -- | -- |
| **Orders** | | | | |
| Create order | -- | Yes | Yes | -- |
| View order pool | Yes | Yes | Yes | Yes |
| Grab order | -- | -- | -- | Yes |
| Assign order | -- | Yes | Yes | -- |
| Confirm order | -- | -- | -- | Yes |
| Complete order | -- | Yes | Yes | Yes |
| Cancel order | -- | Yes | Yes | -- |
| **Customers** | | | | |
| View customers | Own studio | Own studio | Own studio | Assigned only |
| Create customer | Yes | Yes | Yes | -- |
| Update customer | Yes | Yes | -- | -- |
| Delete customer | Yes | Yes | -- | -- |
| View customer orders | Yes | Yes | Yes | Assigned only |
| Reassign customer | Yes | Yes | -- | -- |
| **Companions** | | | | |
| View companions | All | Own studio | Own studio | Self only |
| View ranking | Yes | Yes | Yes | -- |
| Update own status | -- | -- | -- | Yes |
| View companion revenue | Yes | Yes | -- | Self only |
| Send PC command | Yes | Yes | -- | -- |
| **Billing** | | | | |
| Submit transaction | -- | -- | -- | Yes |
| View transactions | Yes | Yes | -- | Own only |
| Approve / Reject | Yes | Yes | -- | -- |
| Batch approve / reject | Yes | Yes | -- | -- |
| View daily/monthly revenue | Yes | Yes | Yes | -- |
| Download revenue CSV | Yes | Yes | Yes | -- |
| View profit/loss stats | Yes (2nd pwd) | -- | -- | -- |
| Manage expenses | Yes | Yes | -- | -- |
| **Studios** | | | | |
| CRUD studios | Yes | -- | -- | -- |
| **Employees** | | | | |
| List / Create employees | Yes | Yes (own) | -- | -- |
| Reset employee password | Yes | Yes (own) | -- | -- |
| **Upload** | | | | |
| Upload screenshot | -- | -- | -- | Yes |

### Data Isolation

- **OWNER:** Sees all data across all studios.
- **ADMIN:** Data scoped to their own studio.
- **CS:** Data scoped to their own studio.
- **COMPANION:** Sees only their own assigned customers, their own orders, and their own transactions.

---

## Security

### Authentication

| Feature | Implementation |
|---------|---------------|
| **Primary auth** | JWT dual-token: access token (15 min) + refresh token (7 days) |
| **Second password** | Separate bcrypt-hashed password required for profit/loss stats. Returns a short-lived `secondToken` (5 min). |
| **Password storage** | bcrypt with salt rounds |
| **User authorization** | CS and COMPANION accounts require owner approval before they can log in |

### Authorization

| Feature | Implementation |
|---------|---------------|
| **RBAC** | Four roles: OWNER, ADMIN, CS, COMPANION |
| **Guard** | `RolesGuard` + `@Roles()` decorator on every protected endpoint |
| **Data isolation** | Every service method receives `req.user` and applies studio/companion scoping |

### API Protection

| Feature | Implementation |
|---------|---------------|
| **Global prefix** | `/api` |
| **CORS** | Origin restricted to `http://localhost:5173` |
| **Input validation** | `class-validator` with `whitelist: true` and `transform: true` |
| **Exception filter** | Global `HttpExceptionFilter` for consistent error responses |
| **File upload** | MIME type whitelist (JPG/PNG/WebP), 5 MB limit, unique filenames |

### WebSocket Security

| Feature | Implementation |
|---------|---------------|
| **Auth on connect** | JWT token verified in `handleConnection`. Invalid tokens are disconnected immediately. |
| **Room isolation** | Clients auto-join studio-scoped and companion-scoped rooms. |

### Audit Trail

| Feature | Implementation |
|---------|---------------|
| **Transaction review** | Every approved/rejected transaction records `reviewedById` |
| **PC operations** | Every remote command acknowledgment is logged to `PCOperationLog` with operator ID and success status |
| **Time logs** | Heartbeat work seconds are recorded to `CompanionTimeLog` with start/end timestamps |

---

## Environment Variables

### Backend (`apps/server/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:<your-password>@localhost:5432/chunlv` |
| `REDIS_URL` | Redis connection string | `redis://:<your-password>@localhost:6379` |
| `JWT_SECRET` | Secret for signing access tokens | _Required_ |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens | _Required_ |
| `PORT` | HTTP server port | `3001` |

### Docker Compose (`docker/docker-compose.yaml`)

| Service | Variable | Default |
|---------|----------|---------|
| PostgreSQL | `POSTGRES_USER` | `postgres` |
| | `POSTGRES_PASSWORD` | _Required_ |
| | `POSTGRES_DB` | `chunlv` |
| Redis | `REDIS_PASSWORD` | _Required_ |

---

## Database Schema

11 Prisma models:

| Model | Table | Purpose |
|-------|-------|---------|
| `User` | `User` | User accounts with role, studio assignment, authorization status, second password |
| `Studio` | `Studio` | Multi-tenant studios |
| `Companion` | `Companion` | Companion profiles: games, status, billing code, revenue share |
| `CompanionPC` | `CompanionPC` | Agent heartbeat state: version, current mode, throttle status |
| `CompanionTimeLog` | `CompanionTimeLog` | Work/entertainment time tracking entries |
| `Order` | `Order` | Orders: type, dispatch method, status, amount, game, duration |
| `Customer` | `Customer` | Customer profiles with platform info, total spent, assignment |
| `Transaction` | `Transaction` | Billing transactions with payment method, screenshot, review status |
| `RevenueDaily` | `RevenueDaily` | Aggregated daily revenue by order type and companion |
| `Expense` | `Expense` | Studio expenses by category |
| `PCOperationLog` | `PCOperationLog` | Audit log of all remote PC operations |

---

## Documents

- [架构说明 (Mermaid 图表)](docs/ARCHITECTURE.md)
- [部署手册](docs/DEPLOYMENT.md)
- [使用手册](docs/USER_MANUAL.md)
- [需求文档 v2.0（现行准绳）](docs/蠢驴电竞陪玩派单管理系统-需求文档-v2.0.md)
- [需求文档 v1.0（历史）](docs/蠢驴电竞陪玩派单管理系统-需求文档.md)
- [系统功能设计](docs/superpowers/specs/2026-06-21-系统功能设计.md)
- [实施计划](docs/superpowers/plans/2026-06-21-系统实施计划.md)
- [变更日志](CHANGELOG.md)

---

> v2.1.0 -- Simplified auth, kick companion, Apple-inspired UI, REST heartbeat, 54 unit tests, Recharts, CSV export, batch billing, screenshot upload, dual-platform Go Agent
