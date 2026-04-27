import { veepooJLBle } from "./jieli_sdk/bleInit"
import { veepooBle, veepooFeature } from "./miniprogram_dist/index"
import { dataStorage } from "./services/dataStorage"
import { bleHub } from "./services/bleHub"
import { ENV } from "./services/env"
const vpJLBle = new veepooJLBle();

App<IAppOption>({
  globalData: {},
  onLaunch() {
    // BleHub 必须在任何 page 加载前 monkey-patch SDK 的 notify 接口,
    // 之后页面调 veepooBle.veepooWeiXinSDKNotifyMonitorValueChange 都进 hub 而不会互相覆盖.
    bleHub.init();

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
    const bleInfo: any = wx.getStorageSync('bleInfo');
    if (bleInfo && bleInfo.deviceId) {
      veepooBle.veepooWeiXinSDKBleReconnectDeviceManager(bleInfo, (res: any) => {
        console.log('[App.onShow] 自动重连=>', res);
        if (res && (res.connection === true || res.reconnect === true)) {
          // BLE 物理通道恢复后必须再走一次密钥核准, SDK 才会推送 type=1 (含 VPDeviceMAC/版本) 等回调,
          // 之后主动请求电量/步数才能拿到数据. bleConnection 首次连接也是同样流程.
          setTimeout(() => {
            try { veepooFeature.veepooBlePasswordCheckManager(); }
            catch (e) { console.warn('[App.onShow] 密钥核准失败', e); }
          }, 500);
          // 拉手表本地缓存的 3 天日常数据 (用户在表上自测的指标兜底). 等密钥核准后再拉, 否则 SDK 不响应.
          setTimeout(() => bleHub.pullHistoryFromWatch(), 2500);
        }
      });
    }
    // 顺便刷 pending 队列（有可能离线时积了几条）
    dataStorage.flushPending().then(r => {
      if (r.ok > 0 || r.fail > 0) console.log('[Sync] App.onShow 补传', r);
    });
  },
})
