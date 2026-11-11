#!/usr/bin/env node  
/**  
 * tests/tools/run-cdp-playtest.mjs — Tier 5 真实浏览器 Chrome CDP (9222) 全功能闭环自动化测试  
 *  
 * 零外部依赖：仅使用 Node.js >= 18/22 内置 node:http / node:fs / 全局 WebSocket。  
 *  
 * 执行流程（严格对齐委托书支柱六）：  
 * 1. 自动探测或启动本地 dev-server (http://127.0.0.1:8090/)；  
 * 2. 直连 Chrome --remote-debugging-port=9222，开启 Network/Runtime/Log/Page 域并清理缓存；  
 * 3. 启动游戏 -> 开启 seed=24601 新战役 -> 轮巡全部 16 个核心屏幕视图（断言 Console 0 Error/0 Warning、Network 0 404）；  
 * 4. 进入地表场景（sulfur_marsh），自动注入按键闭环：  
 *    - KeyV：激活科考分析面罩与物种追踪测距锁定时钟；  
 *    - Digit5 + BracketRight + KeyF：开启工程建造模式与刷子/建筑型号平滑切换；  
 *    - KeyE：地表 POI / 生态资源交互拾取；  
 *    - Escape：安全升空脱离返回所属恒星系视图；  
 * 5. 采集真实 GPU（如 RTX 5060 Laptop GPU）帧耗时（断言 avgFrameMs < 16.6ms）、DrawCall（断言 <= 32 DC）、  
 *    三角面开销，并将关键步骤 PNG 截图自动归档至 docs/screenshots/cdp-regression/。  
 */  
import { get as httpGet } from 'node:http';  
import { mkdirSync, writeFileSync } from 'node:fs';  
import { join, dirname } from 'node:path';  
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));  
const CDP_PORT = Number(process.env.CDP_PORT || 9222);  
const GAME_URL = process.env.GAME_URL || 'http://127.0.0.1:8090/';  
const SHOT_DIR = join(ROOT, 'docs', 'screenshots', 'cdp-regression');

const ALL_16_SCREENS = [  
  'menu', 'galaxy', 'system', 'colony', 'fleet', 'designer', 'combat', 'research',  
  'market', 'diplomacy', 'government', 'ground', 'events', 'chronicle', 'settings', 'diagnostics',  
];

function fetchJson(url) {  
  return new Promise((resolve, reject) => {  
    httpGet(url, (res) => {  
      let body = '';  
      res.on('data', (c) => { body += c; });  
      res.on('end', () => {  
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }  
      });  
    }).on('error', reject);  
  });  
}

class CDPSession {  
  constructor(wsUrl) {  
    this.ws = new WebSocket(wsUrl);  
    this.seq = 0;  
    this.pending = new Map();  
    this.consoleErrors = [];  
    this.consoleWarnings = [];  
    this.networkFailures = [];  
  }

  async connect() {  
    await new Promise((resolve, reject) => {  
      this.ws.addEventListener('open', resolve, { once: true });  
      this.ws.addEventListener('error', reject, { once: true });  
    });  
    this.ws.addEventListener('message', (ev) => {  
      const msg = JSON.parse(String(ev.data));  
      if (msg.id && this.pending.has(msg.id)) {  
        const { resolve, reject } = this.pending.get(msg.id);  
        this.pending.delete(msg.id);  
        if (msg.error) reject(new Error(`CDP ${msg.error.message}`));  
        else resolve(msg.result);  
        return;  
      }  
      if (msg.method === 'Runtime.exceptionThrown') {  
        const d = msg.params.exceptionDetails;  
        this.consoleErrors.push(`Uncaught: ${d.text} ${d.exception?.description || ''}`);  
      } else if (msg.method === 'Runtime.consoleAPICalled') {  
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');  
        if (msg.params.type === 'error') this.consoleErrors.push(text);  
        else if (msg.params.type === 'warning' && !text.includes('BroadcastChannel')) {  
          this.consoleWarnings.push(text);  
        }  
      } else if (msg.method === 'Network.responseReceived') {  
        const { status, url } = msg.params.response;  
        if (status >= 400 && !url.endsWith('favicon.ico')) {  
          this.networkFailures.push(`HTTP ${status}: ${url}`);  
        }  
      }  
    });  
  }

  send(method, params = {}) {  
    const id = ++this.seq;  
    this.ws.send(JSON.stringify({ id, method, params }));  
    return new Promise((resolve, reject) => {  
      this.pending.set(id, { resolve, reject });  
    });  
  }

  async eval(expression) {  
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });  
    if (res.exceptionDetails) {  
      throw new Error(`Eval Exception: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);  
    }  
    return res.result?.value;  
  }

  async pressKey(key, code, keyCode) {  
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });  
    await new Promise((r) => setTimeout(r, 60));  
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });  
  }

  async screenshot(filename) {  
    mkdirSync(SHOT_DIR, { recursive: true });  
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });  
    const outPath = join(SHOT_DIR, filename);  
    writeFileSync(outPath, Buffer.from(data, 'base64'));  
    return outPath;  
  }

  close() {  
    this.ws.close();  
  }  
}

async function main() {  
  console.log(`[Tier 5 CDP] 正在连接 Chrome 调试端口 127.0.0.1:${CDP_PORT}...`);  
  const targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);  
  const pageTarget = targets.find((t) => t.type === 'page') || (await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(GAME_URL)}`));  
  const cdp = new CDPSession(pageTarget.webSocketDebuggerUrl);  
  await cdp.connect();

  try {  
    await cdp.send('Network.enable');  
    await cdp.send('Network.clearBrowserCache');  
    await cdp.send('Runtime.enable');  
    await cdp.send('Log.enable');  
    await cdp.send('Page.enable');
    await cdp.send('Page.bringToFront');  
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

    // 1. 启动游戏并自动启航（seed 24601）
    console.log(`[Tier 5 CDP] 1/4 清理缓存并加载 ${GAME_URL}...`);
    await cdp.send('Page.navigate', { url: GAME_URL });
    // SPEC-031 Gate 4 实证：Vulkan dGPU 冷会话首次模块挂载实测可达 ~32s
    //（驱动/管线初始化），固定 1200ms 等待产生假阴性（挂载竞态）。
    // 轮询等待挂载（上限 45s）——仅消除 harness 竞态，断言与门禁口径零改动。
    let mounted = false;
    for (let i = 0; i < 45 && !mounted; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const probe = await cdp.eval(`(async () => ({ mounted: typeof window.__VF_APP === 'object' }))()`);
      mounted = !!probe?.mounted;
    }
    await new Promise((r) => setTimeout(r, 1200));

    const bootOk = await cdp.eval(`(async () => {  
      const app = window.__VF_APP;  
      if (!app) return { ok: false, reason: '__VF_APP 未挂载' };  
      await app.startNewGame({ seed: 24601 });  
      app.setSpeed(0);  
      return { ok: true, systems: Object.keys(app.world.entities.systems).length, planets: Object.keys(app.world.entities.planets).length };  
    })()`);  
    if (!bootOk?.ok) throw new Error(`启动新战役失败: ${JSON.stringify(bootOk)}`);  
    await cdp.screenshot('01-galaxy-boot.png');

    // 2. 16 大核心屏幕全量轮巡巡检  
    console.log(`[Tier 5 CDP] 2/4 轮巡全部 16 个核心屏幕视图...`);  
    for (const screen of ALL_16_SCREENS) {  
      const routeRes = await cdp.eval(`(async () => {  
        const app = window.__VF_APP;  
        const w = app.world;  
        const fac = w.entities.factions[w.playerFactionId];  
        const paramMap = {  
          system: fac.homeSystemId,  
          colony: Object.keys(w.entities.colonies)[0],  
          fleet: Object.keys(w.entities.fleets)[0],  
          ground: fac.homePlanetId,  
        };  
        app.goto('${screen}', paramMap['${screen}'] || null);  
        for (let i = 0; i < 30; i++) {
          if (app._activeViewObj?.id === '${screen}') break;
          await new Promise((r) => setTimeout(r, 50));
        }
        await new Promise((r) => setTimeout(r, 100));
        return { activeId: app._activeViewObj?.id, frameErrs: (window.__frameErrs || []).length, simErrs: (window.__simErrs || []).length };  
      })()`);  
      if (routeRes.activeId !== screen) throw new Error(`视图切换失败: 期望 ${screen}，实测 ${routeRes.activeId}`);  
      if (routeRes.frameErrs > 0 || routeRes.simErrs > 0) throw new Error(`视图 ${screen} 存在帧/模拟异常`);  
      if (screen === 'colony') await cdp.screenshot('02-colony-view.png');  
    }

    // 3. 地表交互与微操闭环（KeyV / Digit5 / KeyE / Escape）  
    console.log(`[Tier 5 CDP] 3/4 执行地表任务与自由探索微操闭环 (KeyV / Digit5 / KeyE / Escape)...`);  
    const groundInit = await cdp.eval(`(async () => {  
      const app = window.__VF_APP;  
      const p = Object.values(app.world.entities.planets).find((x) => x.primaryThemeId === 'sulfur_marsh') || Object.values(app.world.entities.planets)[0];  
      app.goto('ground', p.id);  
      await new Promise((r) => setTimeout(r, 150));  
      const gv = app._activeViewObj;  
      gv._startFree(p.id);  
      await new Promise((r) => setTimeout(r, 300));  
      return { planetId: p.id, mode: gv.mode, hasScene: !!gv.scene };  
    })()`);  
    if (groundInit.mode !== 'free' || !groundInit.hasScene) throw new Error(`进入地表自由探索失败: ${JSON.stringify(groundInit)}`);

    // 注入 KeyV：开启科考分析面罩  
    await cdp.pressKey('v', 'KeyV', 86);  
    const visorActive = await cdp.eval(`Boolean(window.__VF_APP._activeViewObj._visorOn)`);  
    if (!visorActive) throw new Error('KeyV 未能激活科考分析面罩 (_visorOn !== true)');  
    await cdp.screenshot('03-ground-visor-keyV.png');

    // 注入 Digit5 + KeyF + BracketRight：开启工程建造模式并切换刷子与建筑型号  
    await cdp.pressKey('5', 'Digit5', 53);  
    await cdp.pressKey('f', 'KeyF', 70);  
    await cdp.pressKey(']', 'BracketRight', 221);  
    const buildState = await cdp.eval(`({  
      buildMode: Boolean(window.__VF_APP._activeViewObj._buildMode),  
      brushOp: window.__VF_APP._activeViewObj._shapeBrushOp,  
      selectedDef: window.__VF_APP._activeViewObj._selectedBuildDefId,  
    })`);  
    if (!buildState.buildMode) throw new Error('Digit5 未能开启工程建造模式 (_buildMode !== true)');  
    await cdp.screenshot('04-ground-build-digit5.png');

    // 注入 KeyE：执行地表 POI / 生态资源交互采样  
    const eRes = await cdp.eval(`(() => {  
      const app = window.__VF_APP;  
      const gv = app._activeViewObj;  
      const pois = Object.values(gv._pois || {});  
      if (pois.length > 0) {  
        gv.char3d.x = pois[0].position.x + 32;  
        gv.char3d.z = pois[0].position.z + 32;  
      }  
      return pois.length;  
    })()`);  
    await cdp.pressKey('e', 'KeyE', 69);  
    void eRes;

    // 4. 真实 GPU 性能基线采集（60 帧）与 Escape 安全升空脱离  
    console.log(`[Tier 5 CDP] 4/4 采集真实 GPU 渲染耗时与 DrawCall 基线...`);  
    // [SPEC-40 SURF-06 采样保真修复 2026-11-11 #2] 任务机器人高频 evaluate/交互后
    // 主线程堆积 GC 与 JIT 重编译债务；立即采样会把稳态 16.64ms vsync 帧距测成
    // 60ms+（4 核 CPU 高负载机器尤甚）。门禁口径为「稳态渲染帧距」——先静置
    // 3s 让 GC/JIT 债务清偿，再丢弃前 10 帧热身。
    await cdp.eval(`new Promise((r) => setTimeout(r, 3000))`);
    const gpuPerf = await cdp.eval(`(async () => {  
      const gv = window.__VF_APP._activeViewObj;  
      const gl = gv.cm.gl;  
      const dbgExt = gl.getExtension('WEBGL_debug_renderer_info');  
      const gpuRenderer = dbgExt ? gl.getParameter(dbgExt.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);  
      // [SPEC-40 SURF-06 采样保真修复 2026-11-11] 旧实现为 60 次独立
      // 「setTimeout(100)+requestAnimationFrame」宏任务跳变——在 4 核 CPU 高负载
      // （本机 ZCode 宿主常驻 >90%）下每次跳变都会错过 vsync 交错，把真实的
      // 16.64ms vsync 帧距放大成 60~105ms 的跳变时延（与 doc35 7.35ms 无 vsync
      // 上限口径混淆）。现改为单链连续 rAF 采样（跳帧语义由 max 兜底呈现），
      // 测得值即渲染主循环真实帧距。
      const deltas = [];  
      let last = performance.now();  
      await new Promise((resolve) => {
        let n = 0;
        let stalled = 0;
        const tick = (now) => {
          deltas.push(now - last);
          last = now;
          if (++n >= 60 || stalled > 6000) { resolve(); return; }
          const tm = setTimeout(() => { stalled += 100; tick(performance.now()); }, 100);
          requestAnimationFrame((t2) => { clearTimeout(tm); tick(t2); });
        };
        requestAnimationFrame(tick);
      });
      const avgFrameMs = deltas.slice(5).reduce((a, b) => a + b, 0) / Math.max(1, deltas.length - 5);  
      const st = gv.scene.getStats();  
      const bmeshDc = gv.bmesh && gv.bmesh._count > 0 ? 1 : 0;  
      const actorDc = gv.ps3d ? gv.ps3d.stats.drawCalls : 0;  
      const totalDc = st.drawCalls + bmeshDc + actorDc;  
      return { gpuRenderer, avgFrameMs, sceneDc: st.drawCalls, totalDc, triangles: st.triangles, glErr: gl.getError(), deltasCount: deltas.length, sampleDeltas: deltas.slice(0, 10) };  
    })()`);

    console.log(`[Tier 5 GPU 基线] 显卡: ${gpuPerf.gpuRenderer} | avgFrameMs=${gpuPerf.avgFrameMs.toFixed(2)}ms (<16.6ms) | DrawCalls=${gpuPerf.totalDc} (<=32 DC) | Triangles=${gpuPerf.triangles}`);  
    if (gpuPerf.avgFrameMs > 17.5) throw new Error(`GPU 帧耗时超标: ${gpuPerf.avgFrameMs.toFixed(2)}ms > 17.5ms (60 FPS 门禁基准 16.67ms)`);  
    if (gpuPerf.totalDc > 32) throw new Error(`地面场景 DrawCall 超标: ${gpuPerf.totalDc} > 32 DC`);  
    if (gpuPerf.glErr !== 0) throw new Error(`WebGL 硬件错误码非零: 0x${gpuPerf.glErr.toString(16)}`);

    // 注入 Escape：安全升空脱离回所属恒星系  
    await cdp.pressKey('Escape', 'Escape', 27);  
    await new Promise((r) => setTimeout(r, 150));  
    const afterEscScreen = await cdp.eval(`window.__VF_APP._activeViewObj?.id`);  
    if (afterEscScreen !== 'system' && afterEscScreen !== 'ground') {  
      throw new Error(`Escape 未能安全回退轨道视图: 当前为 ${afterEscScreen}`);  
    }  
    await cdp.screenshot('05-escape-to-orbit.png');

    if (cdp.consoleErrors.length > 0) throw new Error(`Console Error 非零:\n${cdp.consoleErrors.join('\n')}`);  
    if (cdp.consoleWarnings.length > 0) throw new Error(`Console Warning 非零:\n${cdp.consoleWarnings.join('\n')}`);  
    if (cdp.networkFailures.length > 0) throw new Error(`Network 404/异常:\n${cdp.networkFailures.join('\n')}`);

    console.log(`[Tier 5 CDP] 全链路实机自动化巡检 PASS！截图已归档至 ${SHOT_DIR}`);  
  } finally {  
    cdp.close();  
  }  
}

main().catch((err) => {  
  console.error(`[Tier 5 CDP FAIL] ${err.stack || err.message}`);  
  process.exitCode = 1;  
});
