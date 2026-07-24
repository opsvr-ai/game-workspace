# 品牌定制：工作室名称+Logo

## Context
软件改名"陪玩管理系统"，每个工作室可设自定义名称+Logo，客户端及店内所有人看到该品牌。

## 修改

### 1. 全局名称
- 登录页标题: "CHUNLV ESPORTS · 陪玩派单管理系统" → "陪玩管理系统"
- 侧边栏 Header: "Chunlv" → 当前工作室名称
- 浏览器标题

### 2. Studio Schema
- `studio.displayName` String? — 对外显示名称
- `studio.logoUrl` String? — Logo 图片路径

### 3. Studio 编辑 API
- PUT /studios/:id 支持 displayName + logo 上传

### 4. 前端
- 侧边栏顶部显示: [Logo] [工作室名称]
- 登录页显示工作室Logo
- 工作室管理页可上传Logo、编辑显示名称

### 5. JWT payload
暂不改，studio 信息通过 API 获取。

## 修改文件
- `schema.prisma` — Studio 加 displayName + logoUrl
- `studios.service.ts` — update 方法支持新字段
- `studios.controller.ts` — 上传接口
- `LoginPage.tsx` — 标题
- `AppLayout.tsx` — 侧边栏显示
