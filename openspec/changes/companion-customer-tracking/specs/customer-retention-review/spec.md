## ADDED Requirements

### Requirement: 客户删除申请
系统 SHALL 允许陪玩在客户删除其微信后上传截图发起删除申请。

#### Scenario: 发起删除申请
- **WHEN** 陪玩上传客户已删除的截图并发起申请
- **THEN** 系统 SHALL 创建待审核的删除申请

### Requirement: 管理端审核删除
系统 SHALL 由管理端审核删除申请，审核结果 SHALL 为通过或拒绝。

#### Scenario: 审核通过
- **WHEN** 管理端审核删除申请为通过
- **THEN** 系统 SHALL 消除该客户在陪玩端的提醒并从陪玩端客户列表移除

#### Scenario: 审核拒绝
- **WHEN** 管理端审核删除申请为拒绝
- **THEN** 系统 SHALL 保留客户提醒并返回拒绝原因

### Requirement: 管理端永久留存客户
系统 SHALL 在陪玩端删除客户后仍在管理端保留全部客户信息。

#### Scenario: 管理端仍可查看
- **WHEN** 某客户已在陪玩端移除
- **THEN** 管理端 SHALL 仍可查看该客户完整信息与历史记录

### Requirement: 陪玩端与管理端客户筛选
系统 SHALL 支持陪玩端按本人名下客户筛选，管理端按全部陪玩与状态筛选。

#### Scenario: 陪玩端筛选本人客户
- **WHEN** 陪玩在「我的客户」筛选
- **THEN** 系统 SHALL 仅返回该陪玩名下客户

#### Scenario: 管理端按陪玩筛选
- **WHEN** 管理员按陪玩筛选客户
- **THEN** 系统 SHALL 返回该陪玩名下的客户
