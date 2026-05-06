import { veepooJLBle } from "./jieli_sdk/bleInit"
import { veepooBle, veepooFeature } from "./miniprogram_dist/index"
import { dataStorage } from "./services/dataStorage"
import { bleHub } from "./services/bleHub"
import { ENV } from "./services/env"
const vpJLBle = new veepooJLBle();

// wx.onBLECharacteristicValueChange 是全局单 listener — 重复注册会覆盖.
// Jieli BleDataHandler.init 与 Veepoo SDK 都会注册, 谁后注册谁赢, 另一方静默失效
// → S101 (杰理芯片 + Veepoo 私有协议双栈) 上 Veepoo type=1 (含 MAC/版本) 永远收不到
//   → 首页 4 字段永空.
// 解法: monkey-patch 成多 listener 累加 + 一个真实 wx 监听 fan-out 给所有 cb.
// 必须在 bleHub.init() 与 vpJLBle.init() 之前执行, 才能拦截两者的注册调用.
//
// 注意: 微信小程序的 wx 对象方法可能 non-writable, 直接赋值会被静默忽略.
// 所以三步走: 1) 直接赋值, 2) 失败回退 defineProperty 强制定义, 3) 仍失败则在
// 原 wx fn 上注册唯一 master listener, 由 master 模拟 fan-out (虽然其他模块
// 仍会调原 wx 覆盖, 但 master 注册顺序最早, 给后续修复留个开关).
(function installBleNotifyFanout() {
  const W: any = wx;
  console.log('[BleFanout] IIFE 启动, 准备 patch wx.onBLECharacteristicValueChange');
  if (W.__bleFanoutInstalled) { console.log('[BleFanout] 已安装, 跳过'); return; }

  const orig: any = W.onBLECharacteristicValueChange;
  if (typeof orig !== 'function') {
    console.error('[BleFanout] wx.onBLECharacteristicValueChange 不是函数:', typeof orig);
    return;
  }
  const origBound = orig.bind(W);

  const subscribers: Array<(res: any) => void> = [];
  const newFn = (cb: (res: any) => void) => {
    if (typeof cb !== 'function') return;
    if (subscribers.indexOf(cb) === -1) subscribers.push(cb);
    console.log('[BleFanout] 订阅注册, 当前 listener 数=', subscribers.length);
  };

  // 尝试 1: 直接赋值
  let patched = false;
  try {
    W.onBLECharacteristicValueChange = newFn;
    patched = (W.onBLECharacteristicValueChange === newFn);
    console.log('[BleFanout] 直接赋值 patched=', patched);
  } catch (e) {
    console.warn('[BleFanout] 直接赋值抛错:', e);
  }

  // 尝试 2: defineProperty 强制定义
  if (!patched) {
    try {
      Object.defineProperty(W, 'onBLECharacteristicValueChange', {
        value: newFn, writable: true, configurable: true, enumerable: true,
      });
      patched = (W.onBLECharacteristicValueChange === newFn);
      console.log('[BleFanout] defineProperty patched=', patched);
    } catch (e) {
      console.error('[BleFanout] defineProperty 也失败:', e);
    }
  }

  if (!patched) {
    console.error('[BleFanout] !! wx.onBLECharacteristicValueChange 无法被覆盖, fan-out 失效, 4 字段会继续空 !!');
    return;
  }

  W.__bleFanoutInstalled = true;
  W.__bleFanoutSubscribers = subscribers;

  // 注册 master listener (走原始 fn, 此时未被替换)
  try {
    origBound((res: any) => {
      for (const cb of subscribers) {
        try { cb(res); } catch (err) { console.warn('[BleFanout] listener 抛错:', err); }
      }
    });
    console.log('[BleFanout] master listener 已注册, fan-out 就绪');
  } catch (e) {
    console.error('[BleFanout] master listener 注册失败:', e);
  }
})();

/**
 * 5.06-v7: wx.login -> openid 持久化, 多患者轮流用同一台手表的入组研究需求.
 *
 * 触发时机: app onLaunch 一次. 同一微信号每次进小程序拿到的 openid 不变,
 * 所以缓存到 storage 后只在缺失时才重新走流程; 不同微信号扫体验版二维码会进入
 * 各自独立的小程序 storage 沙箱, 自然触发新的 wx.login 拿到新 openid 完成切换.
 *
 * 失败容忍: 后端 WX_APPSECRET 未配置 / 网络不通时静默忽略, 客户端继续工作,
 * 数据 POST 时不带 wxOpenid 进入"未分组"行 (与历史行同处). 后端配置好+下次 onLaunch
 * 自动补齐. 不阻塞主流程.
 */
function ensureWxOpenid(): void {
  const cached = wx.getStorageSync('wxOpenid');
  if (cached && typeof cached === 'string' && cached.length > 0) {
    console.log('[App] wxOpenid 已缓存:', cached.slice(0, 8) + '...');
    return;
  }
  wx.login({
    success: (res: any) => {
      if (!res || !res.code) {
        console.warn('[App] wx.login 无 code:', res);
        return;
      }
      wx.request({
        url: `${ENV.API_BASE}/api/wx/login`,
        method: 'POST',
        data: { code: res.code },
        success: (rsp: any) => {
          const openid = rsp && rsp.data && rsp.data.openid;
          if (typeof openid === 'string' && openid.length > 0) {
            wx.setStorageSync('wxOpenid', openid);
            console.log('[App] wxOpenid 登录成功:', openid.slice(0, 8) + '...');
            // 触发 flushPending: 之前 openid 缺失时入队的数据现在可以补传
            dataStorage.flushPending().then((r: any) => {
              if (r.ok > 0 || r.fail > 0) console.log('[App] wxOpenid 就绪触发 flush:', r);
            });
          } else {
            console.warn('[App] /api/wx/login 返回无 openid:', rsp && rsp.data);
          }
        },
        fail: (err: any) => console.warn('[App] /api/wx/login 网络失败:', err && err.errMsg),
      });
    },
    fail: (err: any) => console.warn('[App] wx.login 失败:', err && err.errMsg),
  });
}

App<IAppOption>({
  globalData: {},
  onLaunch() {
    // BleHub 必须在任何 page 加载前 monkey-patch SDK 的 notify 接口,
    // 之后页面调 veepooBle.veepooWeiXinSDKNotifyMonitorValueChange 都进 hub 而不会互相覆盖.
    bleHub.init();

    // 5.06-v7: 拉 wxOpenid (一次性, 不阻塞 BLE 主流程)
    ensureWxOpenid();

    // 启动数据批量上传调度: 2h 一次 + 23:59 兜底 (用户需求, 减少六元数据库写压力).
    // 多重 flush 触发: 这里启动定时器 + onShow 触发 + 网络恢复 + 重连成功 + 队列堆 80 条紧急.
    dataStorage.startBatchSync();

    wx.setStorageSync('connectionStatus', true)
    vpJLBle.init();
    // 体验版自动开 vConsole；正式版关闭防止用户看到内部日志
    if (ENV.IS_TEST_BUILD) {
      wx.setEnableDebug({ enableDebug: true })
    }
    // 网络从离线恢复时把失败的同步重发一遍
    wx.onNetworkStatusChange((res) => {
      if (res.isConnected) {
        dataStorage.flushPending().then(r => {
          if (r.ok > 0 || r.fail > 0) console.log('[Sync] 网络恢复补传', r);
        });
      }
    });
  },
  onShow() {
    // 5.06-v8: 自动重连逻辑全部下沉到 BleHub.requestReconnect (集中式, 指数退避 1/2/4s 三次).
    // 小程序后台→前台时 BLE 大概率被系统挂起断了, 触发一次重连请求即可;
    // BleHub 内部去重, 重复触发不会发起多次. userDisconnected / 适配器不可用等
    // 跳过条件也都在 BleHub 内统一判断, 这里不重复.
    bleHub.requestReconnect('app-onshow');

    // 顺便刷 pending 队列（有可能离线时积了几条）+ 重新拉起 batch scheduler
    // (小程序后台被挂起会冻结 setInterval/setTimeout, onShow 时必须重置).
    dataStorage.startBatchSync(); // 内部会立即 flush 一次 + 重置 2h/23:59 定时
  },
})
