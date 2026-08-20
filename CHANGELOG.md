# Changelog

All notable changes to 蠢驴电竞陪玩派单管理系统 are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added

- **综合评分三个段位（上等马/中等马/下等马）:** 陪玩综合分按分数划分三段：上等马（≥优秀线）、中等马（≥中等马线）、下等马（低于中等马线）。陪玩「评分规则」弹窗会显示当前段位（🏇上等马 / 🐎中等马 / 🐴下等马）；中等马线可在后台「评分与名额」里设置（默认 25 分）。

- **综合评分权重/优秀线/名额后台可配置 + 校验:** 系统设置新增「🏆 评分与名额」页，可自己设置：月流水满分（分+金额）、续单/复购/首单成功率满分、优秀线、战绩图每组加分、不优秀每日新客名额、每日有效客户名额、每日抢单上限。四项权重满分之和超过 100 或优秀线超过满分时，前端会红字提醒、后端会拒绝保存。

- **陪玩端「评分规则」说明:** 陪玩首页新增「评分规则」入口，点开能看到自己的综合分、各项得分明细（月流水/续单率/复购率/首单成功率/战绩图加分）、优秀线 50 分，以及达到优秀后的权益（0 秒看单、新客不限名额、急单优先推送等），让陪玩看懂怎么提升。

- **陪玩战绩图上传与审核加分:** 陪玩端新增「战绩图上传」，同一陪玩/同一客户最少 3 张为一组；管理端新增「战绩图审核」，采纳后给该陪玩综合评分加分（默认每组 +1 分，可配置 `excellence.battle_screenshot_bonus`），作为客服发小红书的战绩素材，同时鼓励陪玩囤好图。

- **老客户可直接复购、新客必须先首单:** 陪玩自己录入的客户标记为「老客户（isLegacy）」，可直接点「复购」；系统抢来的新客户在未完成首单前，点「续单/复购」会提示「该客户第一次消费，请选择首单」。

- **双陪搭档邀请正负反馈闭环:** 搭档「接受」→ 主陪提示「搭档已同意」；搭档「拒绝」→ 新增 `partner-reject` 接口并通知主陪提示「搭档已拒绝」；搭档倒计时内「未回应」→ 通知主陪提示「搭档未回应」，三种结果主陪都有明确反馈。

- **陪玩可自行录入老客户:** 客户管理「新建客户」现在对陪玩开放；陪玩录入的客户会自动归属到自己名下，之后可直接在系统里进行首单/续单/复购等操作。同时修复了新建客户时缺少 studioId 归属的问题（改为从当前登录用户自动带出工作室，陪玩自动带上自己）。

- **首单/续单/复购支持换陪玩:** 开始服务弹窗新增「主陪」选择框（默认当前账号，可换成同工作室其他陪玩），配合原有「搭档」选择实现换副陪；主陪被换成别人时，原陪玩点确定后会自动把订单交给对方并通知对方接单。

- **服务时长到点提醒续单:** 陪玩服务到约定时长（如 1 小时）时，右下角弹出 Windows 提醒「时间到了，请引导客户续单」，5 秒自动消失；点「续单」会自动结束上一段计时并开始新一段计时，不用手动先结束。

- **客服跟进与资金流水:** 客服添加客户「已通过」后进入「客服跟进中」列表；每单可记录资金流水（转入/转出、金额、对方、备注），用于后续对账和结算。
- **立即打订单超时流转到客服待处理:** 立即打订单超过「消失时间」后自动从抢单池消失，进入客服加急面板最上方并标注「待处理」；客服上传添加截图后消失，或点「一键重新派到抢单池」再次放回。
- **立即打订单消失时间可配置:** 后台「派单等待时间」新增「立即打订单消失时间（分钟）」，老板可自己填写立即打订单从抢单池消失的时长，订单池的「距离消失」倒计时按该配置计算，默认 10 分钟。
- **预约时间与预约单提醒:** 发预约单时新增「预约时间」输入框（自由文本，如“明天晚上8点”），并在订单池显示；预约单发布 1 小时后仍无人接单时，自动通知发单客服跟进对接客户。
- **引流账号列自定义:** 引流账号管理新增「列设置」，支持自定义添加列、左右调整列顺序、删除自定义列，列配置全局保存。
- **引流账号字段扩展:** 引流账号管理新增编号、流量(优/中/差)、账号风格、WiFi、WiFi地区、是否弹过风险、是否封禁过、注册手机号、地推联系人、实名、注册/封禁日期、图片来源备注（可打开本地图片文件夹）等字段。
- **引流账号管理:** 客服端新增「引流账号管理」，可按小红书/抖音/咸鱼/B站/视频号等类型登记引流账号（昵称、账号ID/主页、备注），支持自行添加新平台类型，帮助客服统一管理各平台引流账号。
- **语音通话 TURN 配置:** 新增「语音通话」设置页，老板可自行填写 TURN 服务器地址/账号/密码用于跨网语音中转；通话时从后台动态读取，不再写死在代码里。
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

- **三段位新客名额分别配置:** 抢单名额改为按段位分别设置：优秀（上等马）/ 普通（中等马）/ 不优秀（下等马）每日新客名额各自独立可填（默认 999 / 2 / 1）。

- **接单最高优先级 + 娱乐计费闭环:** 接单中不能切换任何状态；娱乐中/接单中不能直接点「休息」。从娱乐切回空闲会自动结束本次娱乐计费并右下角弹窗显示消费金额；娱乐中接单（接受搭档邀请）也会先弹本次娱乐消费再进入接单。

- **立即打急单流转优先级补全:** 急单现在按顺序流转：线下优秀 → 桥接线下（DIRECT）→ 线下普通 → 线上俱乐部（RENTAL）。桥接线下限时未接再回落到线下普通，线下普通也没空闲时最终流转到线上俱乐部。

- **战绩图按「陪玩/日期」目录存放:** 陪玩上传的战绩图现在存到 `uploads/battle-screenshots/{陪玩名}/{日期}/` 目录，图片按 1.jpg/2.jpg/3.jpg 顺序命名，方便管理端直接进对应陪玩文件夹按日期查看。

- **战绩图改为「空闲时上传到服务器」:** 陪玩任何状态都能选图提交；服务中提交会先暂存在本地队列，等陪玩「空闲」后系统才自动上传到服务器，避免服务中大量传图拖网影响陪客户。

- **战绩图审核改为下载图片包:** 管理端战绩图审核不再用网页预览，改为每条记录一个「下载图片包」按钮，点击后打包成 zip（按 1.jpg/2.jpg/3.jpg 顺序命名）下载到管理端电脑，解压后直接在文件夹里查看原图。

- **前端自动刷新更快 + 显示构建号:** 陪玩/客服端检测前端版本变化并自动刷新的间隔从 30 秒缩短为 10 秒；侧边栏底部新增「前端构建 xxx」小字，方便一眼确认两端是不是同一个前端版本。

- **语音通话界面右下角化:** 来电/呼叫中/通话中不再用全屏界面或底部通栏，改为右下角小型卡片弹窗（头像 + 姓名 + 接听/挂断 + 音量），不遮挡主界面。

- **订单池/派单左侧人员列表重设计:** 人员列表改为「头像 + 状态圆点」的纵向布局：名字加粗、角色/所属工作室/状态分层显示，状态用圆点 + 文字（绿=空闲、红=接单、金=娱乐、橙=休息、灰=离线），游戏改为浅色小胶囊（最多显示 2 个 + 溢出计数），不再把名字、角色、状态、聊天按钮挤在同一行，窄栏里更清晰易读。派单工作台与陪玩端订单池保持同一套样式。

- **彻底移除订单详情页:** 删除各角色的订单详情页路由和组件；订单相关操作统一走订单列表和客户管理（首单/续单/复购/结束服务/删除），不再有单独的详情页。

- **首单只能打一次:** 陪玩开始首单（确认转账后）再点「首单」会提示「正在服务中，当场继续请用续单，打完请点结束服务」；订单完成后提示「首单已完成，下次玩请使用复购」。「续单」仅在服务中可用（当场继续），「复购」用于下次玩（新建订单）。订单详情页也按订单状态区分：未打显示「首单」，已打显示「续单」。弹窗标题同步按 首单/续单/复购 显示。
- **「开始服务」更名为「首单」:** 陪玩端客户列表和订单详情的开始服务按钮、弹窗统一改为「首单」，操作顺序调整为 首单 / 续单 / 复购 / 结束服务 / 删除，语义更清晰。

- **移除已废弃的并行流程:** 删除前端已不再调用的 `completeBilling`、`renew`、`republish` 接口及对应后端路由（这些会创建重复的续单/重发订单，违反“一条数据贯穿始终”原则），让续单/完成统一走会话流程。
- **降低轮询频率，减少卡顿:** 订单池/派单页的倒计时刷新由每秒改为每 5 秒，订单池轮询由 5 秒改为 10 秒、人员列表由 10 秒改为 30 秒、客服待处理由 5 秒改为 10 秒、客服跟进由 10 秒改为 30 秒，显著减少内存/CPU/带宽消耗，避免影响陪玩抢单。
- **页面标题与主色统一:** 全局主色改为霓虹紫（#7C4DFF），页面标题统一渐变文字（青→紫→粉），卡片圆角/阴影更精致，正文背景加淡渐变，整体更年轻、更干净。
- **全站深色外壳 + 浅色内容:** 侧边栏、顶栏改为「指挥官风」深色渐变背景 + 霓虹高亮，中间内容区保持浅色清晰，并把客户追踪中心的配色/渐变/玻璃拟态抽成全局设计令牌供全项目复用。
- **报账/统计金额四舍五入到「毛」:** 报账、对账、流水、结算等金额统计统一四舍五入到 1 位小数（毛），如 308.69 统一显示/统计为 308.7，不再精确到分。
- **优秀综合分「月流水」改为营业月口径:** 综合分中的「月流水」不再统计全部累计流水，改为按营业月统计——当月 1 日 12:00（含）至次月 1 日 12:00（不含），与报账/对账口径一致。
- **优秀陪玩综合分权重调整:** 综合分权重由「月流水 60%」调整为「月流水 50%」，即 月流水(50%) + 续单率(20%) + 复购率(20%) + 首单成功率(10%)；月流水 10000 元为满分（50 分）。
- **代码去重优化:** 订单池的字段格式化（游戏/类型/时长/倒计时等）和时长格式化统一抽取为公共工具函数，消除派单页与订单池页重复代码，后续改显示格式只需改一处。
- **订单池显示简化:** 订单池/派单管理的订单改为一行简洁文字，从左到右依次显示：游戏、首单/续费/复购、陪玩/护航、机密/绝密、时长/局数、单陪/双陪、发布时间、已等待、倒计时；去掉原来一堆彩色标签，避免看着乱。立即打显示已等待时长，预约单显示距开始倒计时。
- **版本管理隐藏版本号:** 版本管理页不再显示具体版本号，陪玩端/客服端统一用「最新」「未更新」标注；顶部卡片去掉「最新版本」数字，只保留在线、已是最新、未更新人数，方便老板一眼看懂而不必认识版本号。
- **陪玩列表交互统一:** 管理端派单管理与陪玩端订单池左侧的陪玩列表统一交互：都显示前 3 个游戏标签、姓名统一用显示名、点列表行或 💬 图标均可打开聊天。
- **菜单路由/命名统一:** 老板端「派单管理」路由与店长端统一为 `/admin/dispatch`；客服端「客户管理」改为「陪玩管理」，与实际页面一致，避免菜单名和内容对不上。
- **菜单单子项直接跳转:** 派单管理、订单管理、客户管理等只有一个子菜单的入口改为点击直接打开对应页面，省掉再点一次二级菜单。
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

- **服务中被误切成空闲:** 陪玩在有进行中的服务会话（已开始计时）时，状态可能被客户端自动/误刷成「空闲」。现在服务进行中禁止切换到空闲/娱乐/休息等状态（REST 接口和 WebSocket 双端拦截），必须点「结束服务」才会回到空闲。

- **双陪搭档邀请收不到/不醒目:** 主陪指定搭档后，搭档端之前只靠页面内通知 + 浏览器 Notification，窗口最小化或打游戏时看不到。现已：①搭档邀请/找搭档邀请增加提示音；②系统通知优先走 Electron 主进程原生通知（新增 `notify` IPC），窗口最小化也能弹出 Windows 通知。

- **客户管理「沟通」点成跟自己聊天:** 陪玩在客户管理点「沟通」时，之前用的是订单的 companionId（也就是陪玩自己）当聊天对象，导致打开的是和自己对话。现已改为和订单发布者（客服）聊天：服务端在客户列表的订单里补发 `csUserId/csUser`，前端按 `csUserId` 打开聊天。

- **急单抢到后点「首单」误报「正在服务中」:** 急单弹窗里的「开始服务」之前直接调用 confirm 接口，只把订单改成「服务中」却不创建计时会话，导致陪玩到客户管理点「首单」时被误判为「正在服务中」。现已把该按钮改为「去客户管理接单」并跳转客户管理，让陪玩走正常的「首单」流程（创建会话 + 开始计时）；同时把已卡在「服务中但无会话」的订单回退为「已抢」。

- **语音通话听不到声音 / 无通话状态 / 铃声刺耳:** 修复三处语音通话问题——①被叫方接听时没有先 `setRemoteDescription(offer)` 就 `createAnswer`，导致协商出的 answer 不含对端媒体，双方听不到声音；现在被叫方先设置对端 offer、双方缓存并补发 ICE 候选。②聊天头部新增「正在语音通话 + 计时」绿点提示，双方都能看到通话状态。③来电铃声从刺耳的高频正弦波改为低音量、渐入渐出的柔和双音。

- **陪玩之间语音通话收不到:** 陪玩端订单池发起点名聊天/语音时，把陪玩的 `companionId` 当成了 `userId` 传给语音信令，而服务端语音中转是按 `user:{userId}` 房间投递的，导致被叫方收不到来电。现已：前端改为传真实 `user.id`；服务端语音信令统一把 `targetUserId` 归一化（companionId → userId），双保险避免同类问题。

- **语音通话接听失败主叫方卡在“拨打中”:** 之前被叫方点击接听但麦克风授权失败/接听出错时，只在本机提示、没有通知主叫方挂断，导致主叫方一直显示“正在呼叫”且无任何提示。现已改为：接听失败时主动通知主叫方挂断；主叫方收到挂断会提示“对方已挂断”；同时加入 45 秒振铃/呼叫超时，无人接听时主叫方提示“对方无应答”并自动结束，双方不会再无限挂着。

- **全网电脑频繁卡顿/客户端闪退（自动更新死循环）:** 自动更新的下载地址被指向 NSIS 安装器（或过期 zip），而 SystemHelper 服务按 zip 解压覆盖安装目录，导致客户端反复「检测到新版本→写更新信号→退出→看门狗重启→再检测」；每台电脑每几秒重复下载约 90MB 安装包，拖垮网络和本机，连带把游戏带闪退。现已改为：`/api/agent/download/latest` 固定返回 win-unpacked 的 zip（供自动更新解压），安装器改到独立 `/api/agent/download/exe`（供全新安装/远程部署）；构建时自动生成并发布 `chunlv-latest.zip`；SystemHelper 更新失败时清掉更新信号并拉起客户端，不再无限重试。

- **WebSocket 兼容 refreshToken:** 客户端主进程改用 refreshToken 后，WebSocket 网关增加对 refreshToken 的校验（原只认 accessToken），避免客户端更新后主进程连不上。

- **订单池人员列表去重与排版:** 左侧人员列表不再显示重复的「在线」标签，改为单一状态（在线/离线/空闲/接单/娱乐/休息），角色以小字跟在名字后，不再与名字重叠；并修复陪玩端订单池侧栏显示乱码 id 的问题。

- **陪玩端长连接改用 refreshToken:** 客户端主进程 WebSocket 之前用 15 分钟过期的 accessToken，开机后若 token 过期就连不上、显示离线；现在优先用 7 天有效期的 refreshToken 保持连接，配合之前的多连接修复，只要电脑开机、客户端运行就不会误判离线（需重新安装客户端生效）。

- **人员列表在线状态统一按心跳判断:** 派单工作台左侧人员的在线/离线改为统一按最后心跳判断（陪玩 + 客服/店长/老板），不再用可能过期的「状态」字段；开机已登录的人会显示在线，没登录的人显示离线，并保留角色标签和工作状态。

- **人员列表客服/店长在线状态区分:** 派单工作台左侧人员里，客服/店长/老板之前只显示角色标签（客服是绿色），看起来像「在线」；现在拆成「角色标签 + 在线/离线」，按最后心跳判断，未登录的客服明确显示「离线」。

- **侧边栏子菜单白色背景彻底修复:** 补充设置 antd Menu 的浅色 `subMenuItemBg` 为透明（之前只设了深色 token），展开「设置」等子菜单不再发白。

- **客服端版本表混入陪玩/显示乱码:** 陪玩端之前也会上报「客服端版本」，导致客服端版本表出现一串乱码 id；现在陪玩端不再报客服端版本，客服端版本表只列客服/店长/老板，未登录的客服显示「未登录」。

- **电脑管理在线状态不再依赖 IP:** 电脑管理页的在线/离线之前用 IP ping 判断，IP 一变就误判离线；现在改为按客户端心跳（2 分钟内有心跳即在线）判断，不随 IP 变化。

- **侧边栏子菜单背景修正:** 展开「设置」等子菜单后，子菜单项不再出现白色背景，保持与深色侧边栏一致。

- **「当前模式」与状态不同步:** 电脑管理里「当前模式」之前默认写死成娱乐且不随状态变化，导致整体状态是空闲、当前模式却显示娱乐；现在状态切换时会同步更新当前模式，首条心跳默认按空闲处理。

- **多连接误判离线:** 陪玩端主进程和页面会各连一条 WebSocket，之前任意一条断开就把陪玩标成「离线」；现在改为只有最后一条连接断开才置为离线，避免明明开着客户端却显示离线。

- **侧边栏底部版本号固定:** 左侧栏向下滚动时，左下角「客户端 v 版本号」不再跟着滚动，固定在侧边栏底部。

- **邀请方也有右下角弹窗:** 陪玩双陪邀请搭档后，邀请方（主陪）也会在右下角弹出提示「已邀请 xx 搭档 / 已广播找搭档」，带 20 秒自动取消提示，不再只有被邀请方看到弹窗。

- **双陪搭档未接受不再显示「服务中」:** 双陪（首单/续单/复购）指定搭档后，在搭档接受前客户列表显示「等待搭档接受」而不是「服务中」，并提供「取消邀请」；20 秒超时或手动取消时，复购订单会一并结束，不再卡在「进行中」。

- **复购双陪搭档邀请不弹窗:** 复购时选择双陪并指定搭档，之前只建了订单和会话、没给搭档发邀请；现在复购指定搭档后会立即给搭档弹「搭档邀请」（含邀请人和 20 秒自动取消），和首单/续单保持一致。

- **结束服务一步到位:** 陪玩点「结束服务」现在会同时结束会话并完成订单（订单直接变为已完成），不再停留在「进行中」导致再点「开始服务」时误报「正在服务中」；去掉了之前右下角「续单/结束服务」二次弹窗，续单用客户列表里的独立「续单」按钮在结束前操作。
- **客户管理「结束服务」不再跳转详情页:** 陪玩端客户列表里点「结束服务」原来会跳到订单详情页，现在直接在当前界面弹出「结束服务」弹窗（填实收金额即可结束），并把结束服务弹窗抽成公共组件，订单详情页也复用同一套，避免两处逻辑不一致。
- **搭档邀请 20 秒自动取消:** 双陪指定/广播搭档后，若对方 20 秒内未接受，系统会自动取消该待接受会话；邀请弹窗同步显示「X 秒后自动取消」倒计时，主陪端会话列表也会自动刷新。
- **双陪待接受会话可取消，不再卡「没有结束按钮」:** 双陪指定/广播搭档后若对方一直没接受，会话会停留在「已建会话但未开始」状态，之前这里错误显示「开始服务」按钮导致没有结束入口；现在改为显示「取消邀请」，主陪可一键取消。同时订单完成/取消时会同步把搭档（coCompanion）状态恢复为空闲，避免主陪/搭档一直卡在「接单中」。
- **搭档邀请后台也能看到并显示邀请人:** 陪玩端收到搭档邀请/广播找搭档时，除应用内右下角弹窗外，额外弹出 Windows 系统通知（最小化或切到微信聊天时也能看到）；邀请文案明确标注是谁邀请的。
- **服务开始接单中过渡:** 服务开始后新增「进入接单中，用心服务」过渡卡片，下方带粗进度条（加载动画），进度条走满后自动提示「已切换到接单状态」并收起。
- **搭档端订单列表同步显示服务中订单:** 陪玩端订单管理改为同时返回「我是主陪」和「我是搭档」的订单，搭档接受后也能在自己的订单列表里看到同一条订单并显示「进行中」。
- **双陪找搭档统一为 acceptPartnerInvite:** 删除旧的三套并行机制（callPartner/acceptPartner、markReady/confirm、发补丁单入池），统一为「指定 / 广播」两种入口都落到同一条会话；搭档接受一律走 `acceptPartnerInvite`，广播入口新增 `order:dual_invite` 通知，第一个接受者自动成为搭档，主陪和搭档双方都开启工作记录截图，并防止主陪接受自己的广播邀请。
- **报账沿用同一条完整数据:** 陪玩上报今日流水改为按「会话」展示，自动带出游戏、模式、客户微信、单价×时长、搭档、开始服务时上传的截图，再叠加修改后的金额和备注；管理端报账明细也能看到完整的模式/单价/时长/搭档信息，全程沿用同一条数据。
- **报账备注说明:** 陪玩上报今日流水时，每条打单记录新增「备注」框（如“客户临时有事，等了很久”），并显示时长列便于解释“计时长但流水低”；备注随报账提交，管理端在报账明细里能看到该备注和对应截图，方便双方对账理解。
- **续单弹窗简化并沿用人员信息:** 陪玩点「续单」同样弹出和「开始服务/复购」一致的简洁弹窗，自动沿用上一单的模式/时长/单双陪/搭档，单价留空可重填；人员信息可修改（续单可能换陪玩/换搭档）。
- **复购弹窗简化:** 陪玩点「复购」不再打开复杂的发布订单弹窗，改为和「开始服务」一样的简单弹窗（单/双陪、模式、单价、时长、搭档、转账截图），提交后直接创建复购订单并开始计时。
- **服务中增加结束服务入口并自动刷新:** 客户管理里「服务中」的客户新增「结束服务」按钮（跳转到订单详情结束会话），并给客户列表加 30 秒静默轮询，确保搭档同意后主陪端能自动看到「服务中/计时/结束服务」状态，不再需要手动刷新。
- **服务计时器:** 客户管理里正在服务的客户会实时显示「服务中 ⏱ 已计时时长」，计时组件做成公共组件可复用；服务开始后主陪和搭档状态、订单状态、金额显示均已同步修正。
- **双陪金额与接单状态修复:** 搭档邀请弹窗改为显示「搭档金额」而非主陪金额；服务开始后主陪和搭档自动切为「接单(BUSY)」，订单状态置为确认，主陪端「开始服务」按钮消失并显示「服务中」，同时右下角提示「搭档已同意，开始计时，进入接单中用心服务」。
- **陪玩定向推送改为房间广播:** 之前按单个 socket 推送，导致陪玩端开了多个连接时收不到搭档邀请/黑名单/群发等定向消息；现在统一改为按 `companion:xxx` / `user:xxx` 房间广播，确保每个终端都能收到。搭档邀请也改为右下角弹窗（接受/拒绝）。
- **双陪搭档确认流程:** 陪玩选双陪并指定搭档后，不再直接开始计时；改为先向搭档发出邀请，搭档端弹窗「接受/拒绝」，搭档接受后才开始计时，并通知主陪。单陪仍直接开始。
- **截图上传 500 修复:** 修复 `/app/uploads/screenshots` 目录被坏符号链接占用导致上传报“服务器内部错误”的问题；上传目录现在会自动清理坏链接/同名文件并重建，且已手动清理线上残留的坏链接。
- **截图上传放宽格式与大小:** 上传截图支持更多图片格式（JPG/PNG/WebP/GIF/BMP/HEIC/TIFF），单文件上限提到 20MB，并放宽空 mimeType 判断；上传失败时前端显示具体错误，便于排查。
- **上传类接口统一修复:** 去掉聊天发图、聊天文件、会话截图、工作室创建、注册上传等所有手动写死的 `Content-Type: multipart/form-data`，交给 axios 自动加 boundary，避免同类上传失败。
- **开始服务改为直接弹窗:** 陪玩在客户管理点「开始服务」不再跳转到订单详情，而是直接弹出开始服务弹窗，内含单/双陪、模式、单价、时长、双陪搭档与搭档单价、找搭档方式、转账截图，提交后直接开始计时。
- **客户全链路轨迹:** 管理端客户详情新增「客户轨迹（来龙去脉）」时间线，把客户进入系统、派单/重新派单、陪玩抢单、开始/结束服务、完成/退款/存单、联系结果、追踪记录、资金转入/转出等按时间串联，方便老板一眼看清每个客户走了哪些环节、卡在哪一步。
- **派单历史记录:** 订单会记录首次派单时间、派单次数和每次派单/重派时间，客服端待处理列表对重派过的订单显示「第X次派」，让一个客户被派了几次、每次什么时候都清晰可查。
- **订单标记“已添加到客服微信”:** 客服先把客户加到客服工作微信、再派出去的订单，陪玩抢到后会在抢单成功弹窗和订单列表里看到「已添加到客服微信」标记，避免陪玩误以为没加过而重复添加。
- **月流水严格按营业月:** 阶梯分成和月度结算统一改为按营业月（1号12:00~次月1号12:00）实时计算业绩流水；月度结算后清零陪玩累计流水；完成订单时主陪/搭档按统一口径分别累计，不再把整单金额都记到主陪头上。
- **发布订单补全客户账号字段:** 发布订单新增「客户账号ID」输入框，用于记录客户自己的小红书/抖音/快手ID（区别于工作室的“来源账号”）；同时修复多个表单字段（来源账号、客户账号、YY号、微信二维码、服务类型、搭档金额、补偿标记、转账截图）因后端 DTO 白名单漏声明而被丢弃的问题。
- **找搭档三种方式:** 开始服务选「双陪」后，「找搭档方式」支持 指定搭档 / 广播找搭档 / 放入订单池 三种，陪玩可按需选择；放入订单池会生成一条带“找搭档”标注的池单供其他陪玩抢。
- **双陪找搭档:** 开始服务弹窗选「双陪」时新增「呼叫搭档」按钮，点击后向工作室广播找搭档请求，其他陪玩收到后点击接受即可成为搭档，解决双陪找不到搭档的问题。
- **开始服务弹窗完善:** 陪玩点「开始服务」不再只是跳转到订单详情，而是直接弹出开始服务弹窗；弹窗新增「单陪/双陪」切换，双陪时可选择搭档并填写搭档单价；去掉订单详情里多余的「续单」按钮（续单保留在“结束服务”后的提示里）。
- **订单池/接单微信自动刷新:** 订单池新增 5 秒轮询，普通陪玩过了延迟后订单会自动出现，不用再手动点刷新；陪玩选择工作微信后，「添加成功/添加失败」按钮立即可用，不再需要手动刷新才能点。
- **所有「优秀/合格」判定统一:** 新客首单名额限制（抢单/直派）和“只推送给空闲且达标的陪玩”也统一改用新的综合分判定（月流水50%+续单20%+复购20%+首单10%，≥50 为优秀），废弃旧的“续单小时数/新客数 ≥ 保本小时”口径，全系统只保留一套优秀标准。
- **优秀判定统一:** 订单池「优秀陪玩立刻看到」的判断口径由旧的「续单率≥30%」统一为与管理端一致的「综合分≥50」（月流水50%+续单20%+复购20%+首单10%），消除两套“优秀”标准打架的问题。
- **营业时间口径统一:** 订单/流水/报账/结算相关的“今日”“本月”统计统一为营业日（每日 12:00 至次日 12:00）和营业月（当月 1 日 12:00 至次月 1 日 12:00），修复此前部分页面按自然日/自然月（0 点）统计导致数字对不上的问题。
- **退款回冲流水:** 已完成的订单退款时，自动回冲陪玩累计流水和客户累计消费，避免退款后财务虚高；同时订单新增 `refundedAt`、`refundReason` 结构化字段区分“退款”与“取消”。
- **存单结构化:** 存单操作新增 `depositedAt`、`depositAmount` 结构化字段，存单金额不再只写在客户备注文本里，方便后续汇总、提醒和对账。
- **聊天体验微信化:** 修复新消息到达时不自动滚到底部、需要手动下拉才能看到的问题；现在在底部会随新消息自动滚动，向上翻历史时则显示「↓ 新消息」按钮。同时把未设置头像时的灰色占位改为按用户自动分配颜色，双方头像可区分，不再全是灰色。
- **聊天消息错乱/头像不对:** 修复从通知点开聊天时把 roomId 当成 userId、在服务端建出“幽灵会话”的问题；同时实时消息现在会带上发送者信息，对方第一次收到消息也能正确显示昵称和头像，不会再出现“文字收不到、头像显示成别人”的情况。
- **客服端自动更新闪退:** 修复客服端更新检查用字符串相等判断版本（`===`）导致版本号不一致时反复下载安装并退出（闪退）的问题；改为按数字比较版本号，只有服务器版本严格更新时才更新。同时把安装包下载移到主进程完成后再退出安装（避免应用一退出就把后台下载进程杀掉、永远装不上），安装时用提权方式装到 Program Files。
- **客服已添加显示修复:** 客服标记「已添加」时，只有上传了凭证才显示绿色「已添加」，未上传凭证显示橙色「未传凭证」，不再同时出现两个标签，避免把没传凭证的也当成已添加。
- **远程开机修复:** 应用容器改为使用主机网络（host network），使 Wake-on-LAN 广播包能真正发到局域网，远程开机不再失效。
- **自动更新改为看门狗执行:** 陪玩端检测到新版本后不再自己装，而是写更新信号，由 SystemHelper 服务以系统权限下载解压并重启，解决普通权限装不上 `C:\Program Files` 的问题。
- **聊天细节修复:** 陪玩侧边栏未读改为显示数字角标；输入框高度用 ResizeObserver 可靠记忆；聊天弹窗高度自适应窗口避免被裁切。
- **双陪流程修复:** 搭档「我已准备好」不再报无权操作；双陪会话自动继承订单里的搭档和搭档金额。
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
