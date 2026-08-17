# Changelog

All notable changes to 蠢驴电竞陪玩派单管理系统 are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added

- **电脑管理 MAC 地址:** 电脑管理新增 MAC 地址字段；电脑在线时自动从 ARP 缓存抓取并回写，离线也能用存储的 MAC 远程开机，不再依赖会过期的 ARP 缓存。支持一键同步所有在线电脑的 MAC。
- **抢单后添加成功/失败闭环:** 抢单跳转订单管理后，陪玩选择「添加成功」会自动进入客户管理；选择「添加失败」需选择原因并上传截图。客户管理新增「删除」操作，需填写原因并上传截图，提交后管理端审核，防止陪玩乱删客户。
- **下班转公户报账:** 陪玩每次开始服务/续单/复购已自动累计当日流水作为参考；新增「转公户」入口，下班前填写业绩金额并上传转给公户的转账截图，以该金额作为当日实际流水的最终口径。
- **动态分析中心:** 新增客户分析和陪玩分析，按订单数据自动计算常玩游戏、常玩模式、平均时长、续单率、复购率、总流水等，并打标签，方便管理端掌握客户和陪玩动态。
- **客户微信跨账号去重抢单:** 抢单前按“当前工作微信 + 已服务客户微信”判断；同一陪玩用同一工作微信服务过该客户后，再次抢到该客户微信会提示并让其抢其他单；更换工作微信后则可正常抢。
- **电脑管理自动回填账号:** 陪玩端连接服务器后，电脑管理页会根据该电脑 IP 自动把当前登录的陪玩账号回填到登录账号字段。
- **电脑管理页:** 新增后台“电脑管理”页面，可维护每台电脑的 IP、登录账号和备注，并支持单独远程关机、重启、睡眠、休眠，以及在线状态显示。
- **全量推送结果明细:** 版本管理页的「全量推送」和「推送更新」完成后，会弹出结果列表并自动等待客户端上报新版本，逐台显示「更新成功 / 更新中 / 更新失败 / 未在线」。
- **客户端版本管理页面显示客服端版本:** 客户端版本页新增“客服端版本”表格，展示客服/店长账号的客户端版本和最后上报时间。
- **客服端版本上报:** 客服端/陪玩端会定时把本地版本上报到服务器，服务端提供客服端版本状态接口，管理端可查看各客服账号客户端版本。
- **客户管理续单/复购入口:** 陪玩端客户列表新增「续单」「复购」按钮，与开始服务一起直接创建对应类型订单。
- **客户详情完成/退款/存单操作:** 客户详情页新增完成服务、退款、存单三个操作；退款和存单会记录到订单与客户备注，并自动把陪玩状态回空闲。
- **陪玩端进程采集:** 陪玩端登录后每 5 分钟自动采集电脑进程列表并上报，管理端「进程黑名单」可从已上报进程中选择加入黑名单。
- **未登录游戏进程看护:** 陪玩端未登录账号时，自动结束三角洲、瓦、PUBG、CS2、永劫无间等常见游戏进程，登录成功后自动解除；避免不登录就脱离管控打私单。
- **客服端开机自动登录:** 客服端支持安全保存账号密码，并在启动时自动填充登录，避免每次开机重复输入。
- **客服端远程自动更新:** 客服端启动后会定时检查客服端新版本，发现更新自动下载并静默安装；服务端新增客服端版本与下载接口。
- **派单优先级与客服提成:** 订单区分线下/线上来源；非立即打只给线下，立即打优先线下空闲且能力达标的陪玩；客服提成支持线下比例+每单保底、线上固定金额，按营业月归属，并按收款微信/账号每日对账。
- **客服桌面客户端:** 新增轻量 Electron 客服端，加载同一套网页系统，支持麦克风语音与系统通知，不含陪玩端的看门狗/锁屏/截图限制。
- **陪玩端订单池陪玩列表:** 陪玩端订单池左侧新增陪玩列表（含状态、头像、擅长游戏、搜索与 💬 聊天入口），与管理端派单工作区保持一致的可见性。
- **客户追踪与抢单门槛:** 新增每日有效客户名额、联系结果登记（现在打/改天/不同意/未回复/已删除/懂哥/退款）、三档可配置抢单门槛（流水/每日名额/综合成功率）、客户追踪（文字/截图/截图+文字）、不消费持续提醒、删除审核与永久留存、管理端客户追踪中心、陪玩端追踪面板及客户 KPI/异常检测。
- **通知设置:** 系统设置新增「通知设置」，可配置声音、桌面与角标提醒。
- **考勤设置:** 系统设置新增「考勤设置」，可配置陪玩每日上下班时间，用于迟到/早退判定。
- **支出/支取审核:** 新增「财务管理 → 支出/支取审核」页，分 tab 审核陪玩 `EXPENSE/WITHDRAW` 申请与钱包流水，支持月度汇总、通过/驳回及备注。
- **客服/店长提成复核:** 提成结算页新增「确认/撤销」操作，`CommissionLedger` 支持 `DRAFT → CONFIRMED` 状态流转。
- **截图阈值配置化:** 系统设置新增「截图阈值」标签，可配置截图间隔区间、首张延迟、每小时期望张数、黑屏判定阈值与最小合格率，客户端动态拉取并用于服务过程留痕标黄/红。
- **陪玩服务证据链增强:** 开始服务必填游戏模式/单价/实际时长/转账截图并写入会话 `duration`；结束服务长图追加「财务核对卡」与「AI 异常分析卡」，转账低于审核金额黄标、0 截图红标，并按「时长×4」校验截图数量。
- **客服派单/提成核对页:** 「每日统计」页升级为客服发单/提成核对工作台，支持日期范围/订单状态/陪玩费状态/游戏名筛选，展示发单客服、认领客服、工作微信、客户付款去向、收款账号及陪玩费状态与方式。
- **报账金额协商闭环:** 管理端可将待审核报账调整为新金额并发起协商（状态 `NEGOTIATING`），陪玩端接受后自动按新金额通过，拒绝则退回待审核并保留原金额；客服也纳入报账审核角色。
- **订单服务结束接入财务审核:** 陪玩结束服务时填写客户实际转账合计（微信 + 支付宝），服务端按「填写时长 × 声明单价」计算审核金额并落库 `auditAmountCents / transferTotalCents / auditStatus`；转账合计低于审核金额自动标红，留空则待核对。

- **财务对账与防私单体系:** 新增 `finance` 模块，统一金额整数分存储与营业日 12 点边界；价格规则（首单底价/续单区间）、客服/店长提成规则与月度结算、月度分成快照（5200/10000 阶梯 + 满 6 个月七三门槛）、每日到账对账（员工收款码实到 vs 应收差额标红）、客户画像与 AI 私单风险工作台（单价偏低/时长腰斩/周消费突降/流失风险评分排序，管理者角色均可查看）。
- **Chat history endpoint:** `GET /api/companions/chat-history/:companionId` returns full chat message history between a studio and a specific companion.
- **客服自抢单/线索养客流程:** 新增 `CLAIMED` 状态、`POST /api/orders/:id/claim` 与 `POST /api/orders/:id/release`，客服可把暂时不玩的池子订单认领到工作微信，待客户要打时再放回抢单池并标记“立即打”。
- **客服发单与认领统计:** 每日统计新增客服认领单数/金额，订单列表展示认领客服、认领工作微信和客户实际收款去向，便于核对客服提成与资金流向。
- **陪玩端安全记住密码:** Electron 登录页新增“记住账号密码”，凭据使用 `safeStorage` 加密后存储，并校验调用页面来源，避免明文保存或跨来源读取。

### Changed

- **续单体验优化:** 结束服务后右下角弹出「祝你续单」；点续单直接复用首单的时长/模式，单价留空重填（续单价格会变），提交成功后弹出「祝贺你续单成功」。
- **进程采集显示进度:** 黑名单页“立即采集该陪玩进程”现在会显示进度条和状态文字，采集完成或超时后自动停止，不再只有一句“指令已发送”。
- **客服联系凭证改为鼓励上传:** 客服标记“已添加客户”不再强制上传凭证，未上传会记录“未传凭证”，管理端订单列表和加急面板可见，方便老板核查谁经常不传。
- **客户端定时自动检查更新:** 陪玩端启动后每 5 分钟自动检查一次新版本，未登录也会检查；不再只能靠重启或手动全量推送。
- **版本页自动刷新:** 版本管理页每 15 秒自动刷新陪玩版本，客服端版本每 60 秒刷新，离开再回来也能直接看到最新状态。
- **发布客户端新版本:** 陪玩端 `1.0.20260826`、客服端 `1.0.20260821`，内置错峰更新、安装包复用与慢速局域网扫描配套改动。
- **降低局域网扫描对网络的影响:** “扫描局域网”不再对两个 /24 网段做高速 ICMP 风暴，改为每个 IP 只 ping 一次且间隔 50ms，避免廉价路由器/交换机被瞬间打挂。
- **降低管理端轮询频率:** 待审核、桥接、报账、联系状态等角标轮询从每 5 秒调整为每 30 秒，减少每个客户端持续产生的短连接。
- **客户端更新错峰与下载复用:** 陪玩端/客服端自动更新加入随机延迟；安装包下载后会复用，避免安装失败时看门狗反复拉起进程又重新拉 80MB+ 安装包。

- **语音通话界面微信化:** 来电和呼叫中改为全屏通话界面，显示头像/姓名和接听、拒绝、挂断按钮。
- **陪玩进程采集改为手动触发:** 不再每 5 分钟自动采集进程；管理端黑名单页选择陪玩后可点「立即采集该陪玩进程」按需采集，避免占用客户端 CPU/内存。
- **忽略打包与本地测试产物:** 新增 `.gitignore` 规则，排除 Electron 打包文件、运行时资源和本地部署/测试临时目录，避免误提交。
- **服务端自动部署:** 新增定时拉取部署脚本与 systemd timer，检测到 `master` 更新后自动安装依赖、构建前后端、执行 Prisma 迁移并重建应用容器。
- **全角色页面统一化：** 6 个功能页面的 12 个 per-role 版本合并为统一的共享组件
  - CustomersPage: 合并 owner/admin/companion 三个客户管理页面
  - OrdersPage: 合并 companion 订单工作流与 CS 订单卡片视图
  - DispatchPage: 合并 CS 派单工作区 + admin 表格视图 + companion 历史记录
  - BillingPage: 合并 admin 报账审核流程 + companion 报账提交
  - CompanionsPage: 合并 admin/CS/companion 三个员工管理页面
  - OrderPoolPage: 合并 companion 抢单池 + admin 订单池查看器
- **共享常量提取：** 统一 orderType/status/companion/customer 等状态配置至 `constants/`，替换 10+ 页面中的内联重复定义
- **12 项不一致修复：** 状态标签冲突(已抢/已接单)、颜色交换(ONLINE/BUSY)、客户状态列缺失、布局不统一、API 客户端不一致、分页文本等

### Fixed

- **客户端更新死循环:** 修复陪玩端更新时复用旧安装包导致反复弹「Install complete, the computer will restart in 5 seconds」并重启的问题；现在每次更新都重新下载最新安装包。
- **离线/未登录客户端黑名单同步:** 陪玩端连接服务器后自动接收当前黑名单规则，离线或未登录的电脑上线后也会立即同步，不再依赖手动在线推送。
- **统一派单到报账为同一条订单数据:** 陪玩抢单后，“客户管理→开始服务”不再新建一条 DIRECT 订单，而是直接回到抢到的池单上开会话；抢单订单也允许直接「完成服务」，避免池单一直挂在进行中、客户和流水重复统计。
- **进程采集 token 过期:** 陪玩端收到采集指令时，先通过鉴权接口自动续期 access token，再把最新 token 交给主进程上报，解决陪玩长时间挂着不操作后采集一直失败的问题。
- **进程采集失败:** 采集进程改为由网页端把最新 token 直接交给主进程执行，不再依赖主进程保存的旧 token，解决长时间登录后采集失败的问题。
- **进程采集失败:** 修复陪玩端 access token 刷新后未同步到主进程的问题，避免主进程用过期 token 上报进程导致采集失败。
- **全量推送客户端不执行更新:** 修正服务端向陪玩端发送更新命令时的字段格式，恢复为客户端兼容的平铺参数，解决“显示已发送但电脑不更新”的问题。
- **未登录不杀进程:** 移除未登录时默认结束游戏进程的逻辑；现在只有账号已登录、陪玩状态为「空闲」且黑名单确实配置了进程时，才会执行杀进程。
- **静态资源不缓存导致重复拉包:** 前端构建产物现在按内容哈希缓存 1 小时，`index.html` 保持 `no-cache`，减少每台客户端反复下载 JS/CSS 造成的局域网压力。

- **客服端登录后界面消失:** 移除登录后自动隐藏窗口的逻辑，客服端登录后会保持显示，方便继续操作。
- **杀进程给出提示:** 陪玩端结束未授权或黑名单进程时会弹出系统通知，提示正在结束哪个进程。
- **客服端登录后自动隐藏:** 客服端登录成功 3 秒后自动隐藏主窗口，减少对桌面工作的占用。
- **语音呼叫无界面/挂断难:** 发起语音后现在会显示“正在呼叫”状态栏和挂断按钮，接听方接通后也有挂断按钮，双方都能主动结束通话。
- **安装包无法覆盖运行中的旧版:** 安装器现在先停止并删除看门狗服务，再结束所有相关进程，避免旧进程被反复拉起导致安装失败。
- **取消订单原因必填:** 陪玩点取消订单时会弹窗要求填写取消原因，不填不能提交，原因写入订单备注。
- **退款原因必填:** 陪玩点退款时会弹窗要求填写具体退款原因，不填不能提交，原因会写入订单备注。
- **陪玩端启动报 package.json 缺失:** 修正打包配置，将 socket.io-client 依赖正确打入应用，避免安装后主进程报 `ENOENT ... package.json`。
- **存单客户单独提醒:** 陪玩端「我的追踪」新增“存单客户”区块，自动列出名下存单客户和备注，方便后续继续服务。
- **首单/续单/复购强制转账截图:** 客户管理里创建服务订单时必须上传客户转账截图，截图写入订单资料；存单客户在客户列表显示「存单」标签。
- **客户添加失败补单闭环:** 客户管理里若微信添加失败，只显示「申请补单」，必须上传失败截图并填写原因；添加成功后才会显示开始服务、续单、复购等操作。
- **注册身份证照片未强制:** 现在所有角色注册都必须上传身份证正反面，否则不能提交。
- **接单状态回空闲判定简化:** 陪玩一次只打一个订单，当前订单完成或取消后直接回「空闲」，不再查询其他订单。
- **休息/重连/接单状态逻辑:** 补上休息超时关机指令；WebSocket 重连不再把娱乐/休息误改成空闲；只有点「开始服务」创建订单时才自动变接单，订单完成/取消后自动回空闲。
- **黑名单进程未在陪玩端执行:** 陪玩端现在接收黑名单更新后每 10 秒检查并结束命中进程，白名单进程不会被误杀。
- **记住密码后开机未自动登录:** 修正自动登录仍使用空输入框状态的问题，勾选记住密码后开机可直接进入系统。
- **远程安装账号密码无法填写:** 「一键全部安装」上方新增管理员账号和密码输入框，避免固定使用 Administrator 空密码导致认证失败。
- **远程安装找不到 psexec.py:** 补充安装 `impacket-scripts` 并让服务端自动探测多个 psexec.py 路径。
- **一键全部安装误报成功:** 前端现在按实际返回结果标记每台设备成功/失败；服务端容器补充远程安装所需的 `impacket` 工具。
- **扫描局域网继续优化:** 容器镜像安装 `fping/ping`，扫描时会快速扫 `192.168.0.0/24` 与 `192.168.1.0/24`，能直接发现局域网存活设备。
- **扫描局域网发现 0 台设备:** 服务端容器现在只读共享宿主机 ARP 表，局域网扫描可列出已通信设备，不再因容器内缺少网络工具而返回 0。
- **语音通话媒体接口不可用:** 客服端/陪玩端现在把局域网地址标记为安全来源，修复点击语音通话时报 `Cannot read properties of undefined (reading 'getUserMedia')`；同时前端在非 Electron/非 HTTPS 环境给出明确提示。
- **管理端退出仍需密码:** 老板/店长/客服点退出现在直接退出，不再要求输入密码；陪玩端仍保留密码保护。
- **聊天输入框高度不记忆:** 手动调整输入框高度后会保存到本地，下次打开聊天窗口自动恢复。
- **来消息无提醒:** 顶部消息铃铛的未读数字现在会持续跳动，并恢复发光动画；非当前聊天的新消息会播放提示音。
- **管理端点头像聊天框显示不全:** 点击陪玩头像现在打开居中、可调大小的完整聊天窗口，不再挤在右侧窄栏里。
- **聊天图片支持右键收藏表情:** 图片消息现在右键菜单会显示“收藏表情”，收藏后进入“⭐ 收藏”表情列表，可像微信一样再次发送。
- **收藏网络表情发送后显示为地址:** 收藏的网络图片 URL 现在会以图片形式插入和显示，收藏列表里也会显示缩略图，而不是发出去一串地址。
- **聊天连接鉴权异常:** `/chat` 通道改为使用注入的 JWT 服务验证 token，修复握手中间件中环境变量读取不稳定导致的 Unauthorized。
- **聊天 WebSocket 连接未注册:** 改用 Socket.IO 握手中间件注册用户连接，解决独立 `/chat` 通道下连接生命周期不触发导致用户无法被找到的问题。
- **聊天消息无法实时收到:** 聊天 WebSocket 此前与业务 WebSocket 共用默认命名空间，导致聊天连接未注册、新消息无法实时推送；现在聊天使用独立 `/chat` 命名空间，双向新消息都能即时送达。
- **客服/店长给陪玩发消息收不到:** 聊天室创建时可能把陪玩 ID 当作用户 ID 写入，导致实时推送和会话列表都找不到接收人；现在服务端会规范化陪玩 ID 为用户 ID，并修复了历史错误会话数据。
- **聊天表情面板交互:** 选择表情后自动关闭，点击面板外或按 Esc 也会关闭，并在光标处插入表情而非追加到末尾，更接近微信输入体验。
- **陪玩端语音通话不可用:** 陪玩端 Electron 此前拒绝所有媒体权限，导致麦克风无法获取；现已允许媒体/通知/剪贴板权限，语音通话可正常发起和接听。
- **前端 `tsc` 构建失败（部署阻塞）：** 升级 `@ant-design/icons` 修复 JSX 图标类型必填错误，并修复历史遗留的多处类型错误（个人中心改名接口缺失、每日结算时间保存、订单会话字段、客服沟通会话参数、抢单成功弹窗字段等），`pnpm build` 现可完整通过。
- **个人中心改名报错：** 新增 `PUT /api/auth/me` 更新昵称接口，修复前端调用不存在的 `updateProfile`。
- **授权退出仍被看门狗拉起:** 陪玩端管理员密码退出后通过全局事件通知 `SystemHelper`，看门狗本次开机内不再自动拉起；重启电脑后恢复正常守护。
- **服务端可选图像依赖阻断启动:** 长图合成改为延迟加载 `sharp`，未安装该依赖时服务端仍可正常启动，仅在合成截图时优雅降级。
- **远程部署脚本凭据注入：** 远程批量部署脚本改用 PowerShell 单引号字面量安全转义管理员账号/密码，并对服务端 URL 做协议与主机白名单校验，阻止恶意凭据或 Host 头注入脚本
- **刷新令牌绕过审核状态：** `refresh` 在签发新令牌前校验 `isAuthorized`，被禁用或未通过审核的 CS/ADMIN/COMPANION 账号无法再通过旧 refreshToken 续期
- **Docker 弱凭据与全网卡暴露：** PostgreSQL/Redis 仅绑定 `127.0.0.1`，密码改为必须通过 `docker/.env` 显式提供，并为 Redis 启用认证

- **看门狗阻塞服务控制：** `SystemHelper` 崩溃退避由阻塞 `time.Sleep(5m)` 改为后台并发启动 + 非阻塞退避，服务可及时响应 Windows SCM 停止/关机请求
- **更新失败重启循环：** 安装器非零退出时不再重启旧版本，避免“下载→失败→看门狗重启→再下载”的无限循环；同时增加重定向上限与 500MB 下载大小限制
- **退出登录残留 WebSocket：** 客户端退出登录时同步断开 Socket.IO，避免旧 token 连接继续存活
- **锁屏密码泄露与解锁竞态：** 移除锁屏 HTML 中内嵌明文密码，改为主进程 IPC 校验；修复异步 `storeSet` 后立即 `window.close()` 的竞态
- **Electron 状态上报缺失：** 增加 preload `onStatusChanged` → 主进程 `companion:status` WS 上报，并接入休息状态锁屏定时器
- **远程页面安全边界：** 限制 Electron 主窗口跨 origin 导航、禁止新窗口与页面权限请求，降低远程页面 XSS/篡改风险
- **心跳间隔不一致：** Electron 客户端心跳由 60 秒统一为服务端期望的 30 秒

- **看门狗误删 app.asar.unpacked：** 修复 SystemHelper 服务 `cleanUnpacked()` 删除 `resources/app.asar.unpacked` 后客户端永久无法启动的问题（asarUnpack 文件是构建时产物，Electron 运行时不会重建；删除后客户端弹 Error 窗口卡死，看门狗误判为健康）
- **无限更新循环：** 修复 updater 版本比较用 `!==` 导致服务器版本与本地不一致（哪怕更旧）时客户端每次启动都下载安装器自杀重装的循环（改为语义化数字比较，仅服务器版本更高才更新）
- **build 脚本残留引用：** 移除 `package.json` build/build:win 中 `cp electron/watchdog.js` 引用（该文件已随应用内看门狗一起删除，导致构建失败）
- **陪玩状态同步：** 修复 Electron 客户端状态变更不通知服务端的 bug（`status:changed` IPC 缺少 `emitStatus` 调用）
- **心跳覆盖状态：** 修复 REST 心跳每 30 秒无条件设为 ONLINE 导致覆写用户主动设置的状态
- **OWNER 空 studioId：** 修复 OWNER 角色黑名单/白名单 API 500 错误（null studioId 不兼容 Prisma 复合唯一键 upsert）
- **unique-names 路由未注册：** 修复装饰器顺序错误导致 `/api/processes/unique-names` 路由被吞掉（TypeScript 装饰器就近绑定）
- **远程控制按钮离线误判：** `isOnline()` 改为优先检查 companion.status 而非仅依赖心跳时间戳
- **客户端进程上报丢失：** 改为 REST 主上报 + WS 辅助，解决 WS 超时导致的上报数据丢失
### Added

- **进程黑名单管理：** 完整的黑名单/白名单进程管控功能
  - 陪玩 Electron 客户端进程采集（PowerShell）、OS 过滤、5 分钟定时上报至服务端
  - 服务端黑名单/白名单 CRUD，工作室级规则 + 陪玩个人覆盖（合并生效）
  - 添加进程支持双模式：从陪玩已上报进程多选 或 手动输入
  - 管理端推送黑名单支持全工作室推送 或 指定陪玩推送（带搜索）
  - 客户端 REST 拉取黑名单（`GET /api/blacklist/my-rules`）+ WebSocket 推送双通道
  - 杀进程前 5 秒倒计时右下角弹窗（进度条 + 立即关闭按钮）+ 杀后确认 toast
  - taskkill 速率限制（5次/10秒）保护
  - 管理端 4 页面：BlacklistPage、WhitelistPage、ProcessKillLogPage、PcControlPage
  - 22 个系统内置白名单进程（微信、浏览器、开发工具等）自动对接
  - CS/ADMIN/OWNER 三角色均可管理黑名单和远程控制
  - 服务端和客户端全链路日志（debug/info/warn/error 分级落盘）

- **工作室类型选择：** OWNER 创建工作室时增加两步式类型选择流程（线下工作室/线上俱乐部）
- 新增 `StudioType` 共享枚举 (`DIRECT | RENTAL`)，前端标签映射为「线下工作室」/「线上俱乐部」
- 工作室列表新增「类型」列，支持编辑时通过 `Segmented` 修改类型
- 后端新增 `CreateStudioDto` / `UpdateStudioDto`（class-validator），全套 CRUD 支持 `type` 字段
- **店长账号开设：** 创建工作室时同步创建店长（ADMIN）账号，含用户名/密码/显示名称，使用数据库事务保证一致性
- **自助个人设置：** 新建 ProfilePage，所有角色可修改密码（旧密码验证）、自定义显示名字、上传头像（本地存储）
- 新增 3 个自助接口：`PUT /auth/me/password`、`PUT /auth/me/profile`、`POST /auth/me/avatar`（multer 文件上传）
- User 模型新增 `displayName` + `avatar` 字段，`UserInfo` / `GET /auth/me` 返回完整资料
- AppLayout 头部展示用户头像和显示名字，点击进入个人设置页

### Removed

- **数据看板精简：** 从 UnifiedDashboard 移除绩效看板和收入流水两个标签页
- 删除 `PerformancePage.tsx`、`admin/RevenuePage.tsx`、`owner/RevenuePage.tsx` 孤儿页面
- 移除后端 `/dashboard/performance/daily`、`/dashboard/performance/monthly` 接口
- 移除后端 `/revenue/daily`、`/revenue/monthly` 及其 CSV 导出接口
- 清理前端 `dashboardApi.dailyPerformance/monthlyPerformance` 和 `billingApi.dailyRevenue/monthlyRevenue` 方法

## [3.0.0] — 2026-06-30

### Added

- **Phase 2 Complete:** All 14 missing modules from requirements V30.0 implemented
- **陪玩钱包：** 押金/余额/冻结/可支取 + 支取申请/审核 + WalletTransaction 模型
- **月底结算：** 阶梯分成自动结算，结算后业绩清零计入余额
- **客户画像：** CustomerProfile (19字段) + CustomerFollowUp 跟进记录
- **客户类型识别：** 首单/复购自动检测 + 活跃/待跟进/流失/待开发状态判定
- **绩效看板：** 每日/全月排行，接单率/续单率/复购率 + 流水结构分析
- **增强服务结算：** 首单+可选续单结算表单，自动创建续单子订单
- **双陪搭档流程：** 呼叫搭档/接受搭档 WebSocket 通知
- **AI客户分析：** 消费力/忠诚度/活跃度评分 + 维护建议 + 话术生成
- **流量池：** 渠道管理/来源追踪/渠道统计
- **陪玩离职处理：** 清空数据/释放工位/释放微信
- **租客授权管理：** TenantAuthorization 模型 + CS权限范围设置
- **工作微信管理：** WorkWechat 模型 + 绑定/解绑/离职自动释放
- CustomerProfile, CustomerFollowUp, WalletTransaction, TenantAuthorization, WorkWechat 模型

- **Phase 1 MVP:** Core business loop complete
- 数据看板：今日流水/订单/在线陪玩/接单率 + 7日趋势图 + 业绩排行 + 异常预警
- 陪玩工作台：今日统计、流水解锁进度、状态时长、状态切换、在线陪玩列表
- 抢单池流水门槛：当日流水≥100元解锁抢单功能
- 报账财务：陪玩端提交报账/支取申请，管理端审核通过/驳回，月度汇总
- 系统配置：流水门槛、阶梯分成、支取比例、下拉选项、超时设置等全局配置
- `Studio.type` 字段区分直营店/租赁店
- `StudioDailyStats` 和 `ExpenseReport` 数据模型
- Dashboard API: GET /dashboard, /dashboard/trend, /dashboard/companions
- Companion workbench API: GET /companions/me/workbench
- Order pool status API: GET /orders/pool/status (with revenue threshold)
- Expense report endpoints: CRUD + review + monthly summary
- Config API: GET/PUT /config with 16 multi-key defaults

### Changed

- Enhanced settings page from 2-card to 6-tab config management
- **月底结算模块：** 阶梯分成自动结算，根据陪玩当月业绩匹配分成阶梯，结算后业绩清零计入可支取余额
- 结算页面：月份选择器 + 执行结算按钮 + 结算结果汇总表 + 历史结算记录查询
- 结算 API: POST /monthly-settlement, GET /monthly-settlement
- 阶梯分成配置通过 SystemConfig (`revenue.share_tiers`) 动态读取，支持自定义阶梯
- Enhanced companion pool page with revenue threshold lock/progress
- Enhanced companion home page with full workbench dashboard
- Added Dashboard admin route as default page
- Enhanced billing pages with expense report submission and review
- feat: companion billing page now includes expense report submission modal
- feat: admin billing page now includes expense report review section with filter tabs
- feat: companion workbench API with today revenue, unlock/free thresholds, and status time tracking
- feat: companion workbench page with stat blocks, progress bars, status durations, and quick status switching
- feat: online companions list with real-time status tags on workbench
- feat: per-game rank and account profiles with visual display
- feat: WeChat-style chat dialog between companion and CS with real-time notifications
- feat: pulsing sidebar avatar indicator for incoming chat messages
- feat: cross-client chat notification via WebSocket broadcast + REST polling
- feat: companion sidebar menu — 首页/抢单中心/报账/客户管理/接单记录/派单记录
- feat: companion dashboard with 4-tab ranking leaderboard (续单率/复购率/昨日业绩/本月业绩)
- feat: Delta Force sub-fields on order creation (护航/陪玩, 机密/绝密/陪做任务, 单陪/双陪, 备注)
- feat: billing mode selector (hour/round) on create order form
- feat: game dropdown selector with dynamic options from system settings
- feat: customer info as 微信+房间码 text inputs on order form
- feat: today new/grabbed/remaining stats in order pool header
- feat: dispatcher name on each order card with clickable chat
- feat: companion details modal with pulsing status dot
- feat: order pool water wave animation header
- feat: companion list page with full info table (CS + companion)
- feat: comprehensive 54 unit tests for all 7 backend services
- feat: Windows client download entry on login page
- feat: add kick companion feature — admin/owner can force companion offline via POST /api/companions/:id/kick
- feat: simplify auth flow — Agent uses username/password login instead of manual JWT token
- feat: companions created by OWNER are auto-authorized (isAuthorized=true)
- feat(agent): add REST heartbeat endpoint for reliable agent registration
- feat(agent): add visual server configuration in WebUI with auto-reconnect
- feat(agent): add Linux support for netctrl and sysctrl (tc, systemctl)
- feat(web): add Apple-inspired light theme with glass-morphism header
- feat(web): add revenue charts with Recharts (bar, line, pie)
- feat(billing): add CSV export for daily and monthly revenue
- feat(billing): add batch approve/reject operations
- feat(billing): add screenshot upload endpoint (Multer, 5MB limit)
- test(server): add unit tests for all 7 backend service modules (54 tests)
- docs: add architecture document with 8 Mermaid diagrams
- docs: add deployment guide (1006 lines) and user manual (713 lines)

#### Core Business
- feat(orders): add DTO validation and state machine (CreateOrderDto, VALID_TRANSITIONS)
- feat(server): add global validation pipe and exception filter
- feat(orders): integrate WebSocket push for real-time order updates
- feat: add owner authorization management with backend + frontend

#### Frontend Pages
- feat(web): add CS orders history page with status filter and read-only table
- feat(web): add admin dispatch management page
- feat(web): add admin customer management page
- feat(web): add admin companions management page with time log expansion
- feat(web): add admin billing review page
- feat(web): add admin revenue flow page with daily/monthly views
- feat(web): add admin PC remote control page
- feat(web): add owner employee management page
- feat(web): add owner studio management page
- feat(web): add owner profit/loss revenue page with second-password gate

#### Agent
- feat(agent): add order notification to WebUI with slide-in animation and 3s polling
- feat(agent): add order confirm/complete actions to WebUI
- feat(agent): add Linux support for netctrl and sysctrl

#### Billing & Revenue
- feat(billing): add batch approve/reject operations
- feat(billing): add CSV export for daily and monthly revenue

### Fixed
- fix: OWNER employees page — remove disabled state on add button, fetch all employees
- fix(agent): improve WebSocket auth with query param fallback
- fix(server): add billing DTO, fix assign validation, add health endpoint
- fix(web): fix render side-effect in admin companions page
- fix(web): map companion API response for reassign Select
- fix(agent): fix system tray icon not showing on Windows
- fix(server): log unexpected exceptions in error filter
- fix(orders): support status query filter in order list endpoint
- fix(web): map companion API response for reassign Select
- fix(web): add recharts imports for owner RevenuePage charts
- fix: improve WebSocket auth with query param fallback

### Changed
- chore: switch frontend port to 8000
- chore: resolve merge conflict in main.ts CORS config
- chore: add .env.example and verify infrastructure
- chore: gitignore Go agent binary, update changelog


## [0.1.0] — 2026-06-21

### Added

#### Infrastructure
- feat: init monorepo with pnpm workspaces (React + Nest.js + shared types)
- feat: add docker-compose for PostgreSQL 16 + Redis 7
- feat: add Prisma schema with 11 models and seed data

#### Authentication & Authorization
- feat: add JWT dual-token authentication (access 15min + refresh 7d)
- feat: add four-role RBAC guard (OWNER/ADMIN/CS/COMPANION) with @Roles decorator
- feat: add second-password verification for profit/loss dashboard (5min secondToken)

#### Core Business — Order Dispatch
- feat: add order dispatch API with create/pool/grab/assign/confirm/complete
- feat: add order status state machine (PENDING, GRABBED, CONFIRMED, DONE)
- feat: add role-filtered order listing and pool endpoint for unassigned orders
- feat: add concurrent-safe grab with atomic status check

#### Core Business — Customer Management
- feat: add customer CRUD API with role-based data isolation
- feat: add customer reassignment and order history per customer
- feat: add auto-generated customer codes and platform tracking

#### Core Business — Companion Management
- feat: add companions API with live status tracking (ONLINE/BUSY/IDLE/OFFLINE)
- feat: add revenue ranking (top 20) and personal revenue with transaction history
- feat: add billing code generation and time log tracking (work vs entertainment)

#### Core Business — Billing & Revenue
- feat: add billing API with transactions, daily/monthly revenue, and profit/loss
- feat: add screenshot upload endpoint (JWT, COMPANION only, 5MB limit)
- feat: add admin approval/rejection workflow and customer totalSpent auto-increment

#### Core Business — Studio & Employee Management
- feat: add studio & employee management API with multi-studio support
- feat: add employee CRUD with auto companion creation and admin password reset

#### Real-time (WebSocket)
- feat: add Socket.IO gateway with JWT authentication on connect
- feat: add companion heartbeat tracking (30s interval) and real-time status broadcast
- feat: add order push to specific companions (order:new) and remote command dispatch

#### Frontend (React)
- feat: add login page with role-based redirect
- feat: add AppLayout with collapsible sidebar and 16 role-based menu items
- feat: add customer management page and dispatch workbench (three-column layout)
- feat: add companion status page with colored badges
- feat: add axios client with automatic token refresh interceptor and zustand auth store

#### Electron 客户端 (Desktop Client)
- feat: add Electron 客户端 with time tracker engine (WORK/ENTERTAINMENT mode switching)
- feat: add WebSocket client with auto-reconnect and 30s heartbeat with timing data
- feat: add Windows network throttling via QoS Policy and remote shutdown/restart
- feat: add local HTTP server on :9876 with REST API and WebView-ready UI

### Fixed
- fix: add .js extensions to shared package imports for CJS resolution
- fix: build shared package to dist/ and point main to compiled output
- fix: go mod tidy, add go.sum, ignore .exe binaries
- fix: add tool dirs to gitignore, fix shared types and composite, move docs

### Changed
- docs: add README, CHANGELOG, CLAUDE.md with auto-update scripts

---

[Unreleased]: https://github.com/opsvr-ai/game-workspace/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/opsvr-ai/game-workspace/tree/v0.1.0
