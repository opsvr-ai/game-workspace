## ADDED Requirements

### Requirement: 优质客户留存率
系统 SHALL 统计工作室优质客户留存率，用于管理端 KPI。

#### Scenario: 计算留存率
- **WHEN** 管理端查看客户 KPI
- **THEN** 系统 SHALL 展示优质客户留存率

### Requirement: 追踪及时率
系统 SHALL 统计陪玩对名下客户的追踪及时率。

#### Scenario: 追踪及时率
- **WHEN** 管理端查看陪玩 KPI
- **THEN** 系统 SHALL 展示该陪玩在规定时间内完成追踪的比例

### Requirement: 客户转化率
系统 SHALL 统计客户从「追踪中」到「已消费」的转化率。

#### Scenario: 转化率
- **WHEN** 管理端查看客户 KPI
- **THEN** 系统 SHALL 展示客户转化率

### Requirement: 响应/投诉风险
系统 SHALL 根据未回复、长时间未追踪与删除申请，计算陪玩响应/投诉风险。

#### Scenario: 风险评分
- **WHEN** 陪玩存在大量「未回复」或长时间未追踪客户
- **THEN** 系统 SHALL 提高该陪玩响应/投诉风险并提示管理端
