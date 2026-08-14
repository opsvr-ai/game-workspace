## ADDED Requirements

### Requirement: 陪玩自有微信录入
系统 SHALL 允许陪玩录入本人工作微信，管理端 SHALL 可查看与维护。

#### Scenario: 录入微信
- **WHEN** 陪玩录入本人工作微信
- **THEN** 系统 SHALL 保存该微信并关联到该陪玩

### Requirement: 离职微信交接
系统 SHALL 在陪玩离职时保留其微信信息并支持交接给后续陪玩。

#### Scenario: 离职交接
- **WHEN** 管理端处理陪玩离职
- **THEN** 系统 SHALL 保留微信信息并支持交接
