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

App<IAppOption>({
  globalData: {},
  onLaunch() {
    // BleHub 必须在任何 page 加载前 monkey-patch SDK 的 notify 接口,
    // 之后页面调 veepooBle.veepooWeiXinSDKNotifyMonitorValueChange 都进 hub 而不会互相覆盖.
    bleHub.init();

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
    // 回到前台先尝试自动重连蓝牙（小程序后台被微信挂起时连接会断）
    // 区分 "用户主动按断开 vs 系统挂起断开":
    //   - 主动断开 (closeBluetoothAdapterManager 设 userDisconnected=true): 不重连,
    //     用户已表达 "现在不想用这块表" 的意图.
    //   - 挂起断开 (没 flag): 自动重连, 没连好就重连.
    const bleInfo: any = wx.getStorageSync('bleInfo');
    const userDisconnected = wx.getStorageSync('userDisconnected');
    if (bleInfo && bleInfo.deviceId && !userDisconnected) {
      veepooBle.veepooWeiXinSDKBleReconnectDeviceManager(bleInfo, (res: any) => {
        console.log('[App.onShow] 自动重连=>', res);
        if (res && (res.connection === true || res.reconnect === true)) {
          // 强制 enable notify (修 iOS already-connected 短路, 否则 type=1/2/9 回包丢失)
          setTimeout(() => bleHub.forceEnableNotify(bleInfo.deviceId), 300);
          // BLE 物理通道恢复后必须再走一次密钥核准, SDK 才会推送 type=1 (含 VPDeviceMAC/版本) 等回调,
          // 之后主动请求电量/步数才能拿到数据. bleConnection 首次连接也是同样流程.
          setTimeout(() => {
            try { veepooFeature.veepooBlePasswordCheckManager(); }
            catch (e) { console.warn('[App.onShow] 密钥核准失败', e); }
          }, 800);
          // 强写心率/血氧/体温自动监测开关 (出厂值不可信)
          setTimeout(() => bleHub.enableAutoMonitoring(), 1500);
          // 拉手表本地缓存的 3 天日常数据 (用户在表上自测的指标兜底). 等密钥核准后再拉, 否则 SDK 不响应.
          setTimeout(() => bleHub.pullHistoryFromWatch(), 2500);
        }
      });
    }
    // 顺便刷 pending 队列（有可能离线时积了几条）+ 重新拉起 batch scheduler
    // (小程序后台被挂起会冻结 setInterval/setTimeout, onShow 时必须重置).
    dataStorage.startBatchSync(); // 内部会立即 flush 一次 + 重置 2h/23:59 定时
  },
})
