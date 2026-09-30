'use strict';
/**
 * 机器上报 / 远程任务执行（陪玩端主进程用）。
 *
 * 老板 2026-09-30 要求「所有人的电脑都要能被远程查看 / 一键诊断」，所以陪玩端也接上
 * 这套台账：每 5 分钟上报机器信息，每 60 秒领一次远程任务（一键诊断 / 下发的指令 /
 * 一键开通远程管理），执行完把报告传回服务端。
 *
 * 这条路是「客户端主动往外连」的，不依赖中继机、不需要在被控机器上开端口。
 *
 * 这份文件的实现和客服端**完全一致**：apps/cs-electron/machine-agent.js
 * 改那边的时候必须同步改这边（两个安装包是分开打的，没法共用一份文件）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPORT_TOKEN = 'c4f1a2e7d9b8435fa6e10c7d2b9f8e34';
const REPORT_INTERVAL_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 60 * 1000;
const START_DELAY_MS = 20 * 1000;
const MAX_OUTPUT_CHARS = 380000;

function nowIso() {
  return new Date().toISOString();
}

/** 找一张「真实」网卡：跳过 127.0.0.1、虚拟网卡和 169.254 自动地址。 */
function collectNetwork() {
  const ips = [];
  let mac = '';
  let primary = '';
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const addr of nets[name] || []) {
        if (addr.family !== 'IPv4' || addr.internal) continue;
        if (/^169\.254\./.test(addr.address)) continue;
        if (/virtual|vmware|vmnet|hyper-v|loopback|docker|vethernet/i.test(name)) continue;
        ips.push(addr.address);
        if (!mac && addr.mac && addr.mac !== '00:00:00:00:00:00') mac = addr.mac;
        if (!primary && /^192\.168\./.test(addr.address)) primary = addr.address;
      }
    }
    if (!primary) primary = ips[0] || '';
    if (!mac) {
      for (const name of Object.keys(nets)) {
        for (const addr of nets[name] || []) {
          if (addr.family === 'IPv4' && !addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
            mac = addr.mac;
            break;
          }
        }
        if (mac) break;
      }
    }
  } catch (err) {
    // 拿不到网络信息不影响其它字段
  }
  return { ips, primary, mac: mac.toUpperCase().replace(/:/g, '-') };
}

function hostName() {
  return os.hostname() || process.env.COMPUTERNAME || '';
}

/** 机器唯一标识：计算机名 + 网卡 MAC。两台机器不会撞，换了 IP 也认得出来。 */
function machineId() {
  const net = collectNetwork();
  const macPart = String(net.mac || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const base = hostName().toLowerCase().replace(/[^a-z0-9-]/g, '');
  return macPart ? base + '-' + macPart : base;
}

function osText() {
  try {
    const v = process.getSystemVersion ? process.getSystemVersion() : os.release();
    return os.type() + ' ' + v + ' (' + os.arch() + ')';
  } catch {
    return os.type() + ' ' + os.release();
  }
}

function tmpFile(name) {
  const dir = path.join(os.tmpdir(), 'chunlv-agent');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return path.join(os.tmpdir(), name);
  }
  return path.join(dir, name);
}

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function runPowerShell(args, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    const out = [];
    const err = [];
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      finish({ code: null, stdout: out.join(''), stderr: err.join('') + '\n[客户端] 执行超时已被中断' });
    }, timeoutMs);
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], {
        windowsHide: true,
      });
    } catch (spawnErr) {
      finish({ code: -1, stdout: '', stderr: String(spawnErr && spawnErr.message) });
      return;
    }
    child.stdout.on('data', (d) => out.push(String(d)));
    child.stderr.on('data', (d) => err.push(String(d)));
    child.on('error', (e) => finish({ code: -1, stdout: out.join(''), stderr: String(e && e.message) }));
    child.on('close', (code) => finish({ code, stdout: out.join(''), stderr: err.join('') }));
  });
}

function createMachineAgent(options) {
  const {
    app,
    clientType = 'CS',
    getServerUrl,
    getLoginUser,
    log = () => {},
  } = options;

  let reportTimer = null;
  let pollTimer = null;
  let running = false;
  let started = false;

  function credentialsUser() {
    try {
      if (typeof getLoginUser === 'function') {
        const v = getLoginUser();
        if (v && typeof v === 'object') return { username: v.username || '', role: v.role || '' };
        if (typeof v === 'string') return { username: v, role: '' };
      }
    } catch {}
    return { username: '', role: '' };
  }

  function buildReport(extra) {
    const net = collectNetwork();
    const login = credentialsUser();
    return Object.assign(
      {
        machineId: machineId(),
        clientType,
        hostname: hostName(),
        windowsUser: (process.env.USERDOMAIN || '') + '\\' + (process.env.USERNAME || os.userInfo().username || ''),
        loginUser: login.username,
        loginRole: login.role,
        ips: net.ips,
        primaryIp: net.primary,
        mac: net.mac,
        os: osText(),
        appVersion: app ? app.getVersion() : '',
        source: clientType === 'CS' ? 'cs-client' : 'companion-client',
      },
      extra || {},
    );
  }

  async function post(pathname, body) {
    const base = String(getServerUrl() || '').replace(/\/+$/, '');
    if (!base) throw new Error('没有服务器地址');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    try {
      const res = await fetch(base + pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-onboard-token': REPORT_TOKEN },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text, status: res.status };
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function getJson(pathname) {
    const base = String(getServerUrl() || '').replace(/\/+$/, '');
    if (!base) throw new Error('没有服务器地址');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    try {
      const res = await fetch(base + pathname, {
        headers: { 'x-onboard-token': REPORT_TOKEN },
        signal: ctl.signal,
      });
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /** 把服务端下发的脚本落到临时文件（PS 5.1 必须带 BOM，否则中文变乱码）。 */
  function writePs1(script, taskId) {
    const file = tmpFile('task-' + String(taskId).slice(0, 8) + '.ps1');
    fs.writeFileSync(file, '\uFEFF' + String(script || ''), 'utf8');
    return file;
  }

  async function executeTask(task) {
    const startedAt = Date.now();
    const timeoutMs = Math.max(30, Number(task.timeoutSec) || 240) * 1000;
    if (task.mode === 'command') {
      const res = await runPowerShell(['-Command', String(task.command || '')], timeoutMs);
      const lines = stripBom(String(res.stdout || '')) + (res.stderr ? '\n---- stderr ----\n' + String(res.stderr) : '');
      return { lines, exitCode: res.code, error: res.code === 0 ? '' : 'exit=' + res.code, tookMs: Date.now() - startedAt };
    }

    const scriptFile = writePs1(task.script, task.id);
    const outFile = tmpFile('task-' + String(task.id).slice(0, 8) + '.log');
    const base = String(getServerUrl() || '').replace(/\/+$/, '');
    const args = ['-File', scriptFile];
    for (const a of Array.isArray(task.args) ? task.args : []) {
      args.push(String(a).replace('__OUT__', outFile).replace('__SERVER__', base));
    }
    if (String(task.type) === 'diag' && !(Array.isArray(task.args) && task.args.length)) args.push('-OutFile', outFile);
    const res = await runPowerShell(args, timeoutMs);
    let lines = '';
    try {
      if (fs.existsSync(outFile)) lines = stripBom(fs.readFileSync(outFile, 'utf8'));
    } catch {}
    if (!lines) {
      lines = '[客户端] 脚本没有生成报告文件，退回命令输出：\n' + stripBom(String(res.stdout || ''));
    }
    if (res.stderr) lines += '\n---- stderr ----\n' + String(res.stderr);
    return { lines, exitCode: res.code, error: res.code === 0 ? '' : 'exit=' + res.code, tookMs: Date.now() - startedAt };
  }

  async function runOnce() {
    if (running) return;
    running = true;
    try {
      const machineKey = machineId();
      const json = await getJson('/api/agent/machine-tasks?machineId=' + encodeURIComponent(machineKey) + '&limit=3');
      const tasks = (json && json.data && json.data.tasks) || [];
      for (const task of tasks) {
        log('领到远程任务 ' + task.type + ' ' + task.id);
        let result;
        try {
          result = await executeTask(task);
        } catch (err) {
          result = { lines: '', exitCode: null, error: String((err && err.message) || err), tookMs: 0 };
        }
        try {
          await post('/api/agent/machine-task-result', {
            taskId: task.id,
            machineId: machineKey,
            hostname: hostName(),
            status: result.error ? 'failed' : 'ok',
            exitCode: typeof result.exitCode === 'number' ? result.exitCode : null,
            lines: String(result.lines || '').slice(0, MAX_OUTPUT_CHARS),
            error: result.error || '',
            tookMs: result.tookMs || 0,
          });
          log('远程任务已回执 ' + task.id);
        } catch (err) {
          log('远程任务回执失败 ' + task.id + ': ' + ((err && err.message) || err));
        }
      }
    } catch (err) {
      // 服务器连不上是常态（断网/重启），不打扰客服
    } finally {
      running = false;
    }
  }

  async function reportOnce(extra) {
    try {
      await post('/api/agent/machine-report', buildReport(extra));
      log('机器信息已上报');
    } catch (err) {
      log('机器信息上报失败: ' + ((err && err.message) || err));
    }
  }

  function start() {
    if (started) return;
    started = true;
    setTimeout(() => {
      reportOnce();
      runOnce();
    }, START_DELAY_MS + Math.floor(Math.random() * 20000));
    reportTimer = setInterval(() => reportOnce(), REPORT_INTERVAL_MS);
    pollTimer = setInterval(() => {
      reportOnce();
      runOnce();
    }, POLL_INTERVAL_MS);
    if (reportTimer.unref) reportTimer.unref();
    if (pollTimer.unref) pollTimer.unref();
  }

  function stop() {
    if (reportTimer) clearInterval(reportTimer);
    if (pollTimer) clearInterval(pollTimer);
    reportTimer = null;
    pollTimer = null;
    started = false;
  }

  return { start, stop, reportOnce, runOnce, machineId, buildReport };
}

module.exports = { createMachineAgent, machineId, collectNetwork, hostName };
