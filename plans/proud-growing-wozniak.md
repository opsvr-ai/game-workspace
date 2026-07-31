# Plan: Electron 端一键远程批量部署

## Context

Web 端部署助手只能生成脚本让管理员复制后手动执行。在 Electron 客户端中可以直接调用系统命令执行 PowerShell 脚本，实现真正的一键部署。

## 方案

### 核心思路

```
AgentVersionPage (Web UI)
  │
  ├─ 检测 window.electronAPI 是否存在
  │
  ├─ 不存在 → 复制脚本按钮（现有行为）
  │
  └─ 存在 (Electron) → 「一键部署」按钮
        │
        └─ ipcRenderer.invoke('deploy:execute', { script })
              │
              └─ main.ts IPC handler
                    │
                    ├─ 写入临时 .ps1 文件
                    ├─ child_process.execFile('powershell', ['-File', scriptPath])
                    ├─ 实时输出到渲染进程
                    └─ 返回结果 { success, output }
```

### 修改文件 (4 个)

| # | 文件 | 改动 |
|---|------|------|
| 1 | `apps/companion-electron/electron/preload.ts` | 暴露 `executeRemoteDeploy(script)` IPC 调用 |
| 2 | `apps/companion-electron/electron/main.ts` | 新增 `deploy:execute` IPC handler，保存脚本并执行 |
| 3 | `apps/companion-electron/src/types/electron.d.ts` | 补充 `executeRemoteDeploy` 类型声明 |
| 4 | `apps/web/src/pages/admin/AgentVersionPage.tsx` | 检测 Electron 环境，新增「一键部署」按钮 + 实时输出 |

### 详细设计

#### 1. preload.ts — 新增 API

```typescript
executeRemoteDeploy: (script: string) =>
  ipcRenderer.invoke('deploy:execute', script),
```

#### 2. main.ts — 新增 IPC handler

```typescript
ipcMain.handle('deploy:execute', async (_e, script: string) => {
  // 1. 写入临时脚本文件
  const scriptPath = path.join(app.getPath('temp'), 'chunlv-remote-deploy.ps1');
  fs.writeFileSync(scriptPath, script, 'utf-8');

  // 2. 执行 PowerShell
  return new Promise((resolve) => {
    const child = execFile('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
    ], { timeout: 600_000 }, (err, stdout, stderr) => {
      // 3. 清理临时文件
      try { fs.unlinkSync(scriptPath); } catch {}
      resolve({
        success: !err,
        output: stdout || stderr,
        error: err?.message,
      });
    });
  });
});
```

#### 3. electron.d.ts — 补充类型

```typescript
executeRemoteDeploy: (script: string) => Promise<{ success: boolean; output: string; error?: string }>;
```

#### 4. AgentVersionPage.tsx — Electron 环境检测

在远程部署脚本生成后，检测 `window.electronAPI`：

- **有 electronAPI**：显示「⚡ 一键部署」按钮 + 实时输出区域
  - 点击 → `electronAPI.executeRemoteDeploy(script)` 
  - 显示 loading → 输出结果
- **无 electronAPI**：显示现有「复制脚本」按钮（不变）

```typescript
const isElectron = typeof window !== 'undefined' && window.electronAPI;

// ...在远程部署区域
{isElectron ? (
  <Button onClick={handleElectronDeploy}>⚡ 一键部署</Button>
) : (
  <Button onClick={handleCopyRemote}>复制脚本</Button>
)}
```

## 验证

1. 在 Electron 客户端中打开 AgentVersionPage
2. 输入目标 IP + 管理员密码
3. 点击「生成远程部署脚本」→ 生成脚本
4. 点击「⚡ 一键部署」→ PowerShell 执行 → 查看实时输出
5. 确认目标电脑安装成功
