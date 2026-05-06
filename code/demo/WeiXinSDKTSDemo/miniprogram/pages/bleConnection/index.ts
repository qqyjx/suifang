// pages/bleConnection/index.ts
import { veepooBle, veepooFeature } from '../../miniprogram_dist/index'
import { dataStorage } from '../../services/dataStorage'
import { ENV } from '../../services/env'
import { dispatchBleData } from '../../services/bleDispatcher'

const SCAN_TIMEOUT_MS = 30000








Page({

  /**
   * 页面的初始数据
   */
  data: {
    bleList: [],
    isIOS: false,
    statusText: '扫描中…',
    isTestBuild: ENV.IS_TEST_BUILD
  },

  scanTimer: 0 as any,
  scanSeenCount: 0,
  scanMatchedCount: 0,

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad() {
    let self = this;
    try {
      const info = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()
      if ((info as any).platform === 'ios') self.setData({ isIOS: true })
    } catch (e) {
      console.warn('[bleConnection] getDeviceInfo failed, fallback skipped:', e)
    }

    // 修 "断开后再连搜不到 S101" 的关键: 完整重置 BLE 通道.
    //
    // 用户路径:
    //   首页连上 -> 看到 4 字段 -> 点 "断开连接" 或 iOS 系统断开
    //   -> 进 "设备扫描" 页 -> 一直 "正在搜索..." 搜不到 S101
    //
    // 根因: closeBLEConnection 只切了 wx 应用层 BLE session, iOS CoreBluetooth
    // 系统层的 paired 状态可能仍持有, 表停在 paired-disconnected 不广播.
    // 必须 closeBluetoothAdapter (整个 BLE 适配器关) + openBluetoothAdapter
    // (重新打开) 让 wx 端忘记旧连接, iOS 释放 pair, 表重新进入 advertising.
    const startScan = () => {
      if (ENV.IS_TEST_BUILD) self.attachRawBleDiagnostics();
      self.veepooSDKGetSetting();
      self.BLEConnectionStateChange();
    };

    const stale: any = wx.getStorageSync('bleInfo');
    const closeOldConnFirst = (cb: () => void) => {
      if (stale && stale.deviceId) {
        wx.closeBLEConnection({
          deviceId: stale.deviceId,
          complete: (r: any) => {
            console.log('[bleConnection] 进扫描页前 close 旧 BLE', r && r.errMsg);
            cb();
          },
        });
      } else {
        cb();
      }
    };

    closeOldConnFirst(() => {
      // 重置 BLE adapter (close 整个适配器再 open).
      // 这一步是修扫不到的杀手锏: iOS 上仅 closeBLEConnection 不够, 系统层的
      // paired 状态会让表停在 paired-disconnected. closeBluetoothAdapter
      // 等于跟 iOS 说 "我不要这个 BLE session 了", 触发系统释放 pair.
      wx.closeBluetoothAdapter({
        complete: () => {
          setTimeout(() => {
            wx.openBluetoothAdapter({
              complete: (r: any) => {
                console.log('[bleConnection] BLE adapter 重置完成, 启动扫描', r && r.errMsg);
                startScan();
              },
            });
          }, 300);
        },
      });
    });
  },

  // 体验版诊断：直接挂微信原生 onBluetoothDeviceFound + adapterState
  // 区分 "SDK 回调没触发" vs "微信原生层就没结果"（多半是被其他 App 占用 / iOS 权限拒绝）
  attachRawBleDiagnostics() {
    try {
      wx.onBluetoothAdapterStateChange((res: any) => {
        console.log('[BLE raw adapter]', JSON.stringify(res))
      })
      wx.onBluetoothDeviceFound((res: any) => {
        const ds = res && res.devices || []
        ds.forEach((d: any) => {
          console.log('[BLE raw found]', d.name || d.localName || '(无名)',
            'RSSI=', d.RSSI, 'id=', d.deviceId)
        })
      })
    } catch (e) {
      console.warn('[bleConnection] raw diagnostics attach failed:', e)
    }
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {

  },
  onHide() {
    this.StopSearchBleManager()
    if (this.scanTimer) { clearTimeout(this.scanTimer); this.scanTimer = 0 }
  },

  onUnload() {
    if (this.scanTimer) { clearTimeout(this.scanTimer); this.scanTimer = 0 }
  },

  veepooSDKGetSetting() {
    let self = this;
    let arr: any = []
    self.scanSeenCount = 0
    self.scanMatchedCount = 0
    self.setData({ statusText: '正在搜索附近的设备…', bleList: [] })
    // 获取手机设置状态
    veepooBle.veepooWeiXinSDKStartScanDeviceAndReceiveScanningDevice(function (res: any) {
      const device = res && res[0]
      if (!device || !device.name) return
      self.scanSeenCount++
      // 体验版打印每个扫描到的设备，便于排查白名单/RSSI 误杀
      if (ENV.IS_TEST_BUILD) {
        console.log('[BLE scan]', device.name, 'RSSI=', device.RSSI, 'id=', device.deviceId)
      }
      // 过滤 1：弱信号（医院 100 表场景，避免列出隔壁房间的）
      if (typeof device.RSSI === 'number' && device.RSSI < ENV.MIN_BLE_RSSI) {
        self.refreshStatus(arr.length); return
      }
      // 过滤 2：设备名前缀白名单（VP-W680 / S101 / VPR04 等兼容机型）
      // 体验版下绕过白名单，列出所有非空名设备，便于现场确认真实广播名
      const matched = ENV.IS_TEST_BUILD
        ? true
        : ENV.SUPPORTED_DEVICE_PREFIXES.some(p => device.name.startsWith(p))
      if (!matched) {
        self.refreshStatus(arr.length); return
      }
      self.scanMatchedCount++
      // 同 deviceId 去重（SDK 可能重复回调）
      if (arr.find((d: any) => d.deviceId === device.deviceId)) {
        self.refreshStatus(arr.length); return
      }
      arr.push(device)
      self.setData({
        bleList: arr.sort((a: any, b: any) => b.RSSI - a.RSSI)
      })
      self.refreshStatus(arr.length)
    })
    // 扫描超时自动停止（防患者放下手机后扫描跑一夜耗电）
    if (this.scanTimer) clearTimeout(this.scanTimer)
    this.scanTimer = setTimeout(() => {
      self.StopSearchBleManager()
      const tip = self.scanSeenCount === 0
        ? '未找到设备，请确认手表已开机且蓝牙已开启'
        : '附近无可连接的设备'
      self.setData({ statusText: tip })
      wx.showToast({ title: tip, icon: 'none' })
    }, SCAN_TIMEOUT_MS)
  },

  // 状态行：用户面向语言，调试细节走 vConsole
  refreshStatus(listLen: number) {
    if (listLen > 0) {
      this.setData({ statusText: '' })
    } else {
      this.setData({ statusText: '正在搜索附近的设备…' })
    }
  },

  connectionDevice(e: any) {
    let self = this;
    let deviceList = self.data.bleList;
    wx.showLoading({
      title: '连接中'
    })
    this.StopSearchBleManager()
    deviceList.forEach((item: any) => {
      if (item.deviceId == e.currentTarget.dataset.deviceid) {
        wx.setStorageSync('bleInfo', item)
        // 连接
        veepooBle.veepooWeiXinSDKConnectionDevice(item, function (result: any) {
          wx.hideLoading()
          console.log("连接的result=>", result)
        })
      }
    })
  },

  connectBle(e: any) {
    let self = this;
    let deviceList = self.data.bleList;
    wx.showLoading({
      title: '连接中'
    })

    this.StopSearchBleManager()
    deviceList.forEach((item: any) => {
      if (item.deviceId == e.currentTarget.dataset.deviceid) {
        wx.setStorageSync('bleInfo', item)
        // 用户主动选设备 = 重新允许自动重连. 清掉之前 closeBluetoothAdapterManager 设的 flag.
        wx.removeStorageSync('userDisconnected');
        // 老 storage 残留的 VPDevice 快照可能让首页一进去就显示假数据,
        // 真正密钥核准还没回时 UI 就冒出旧 MAC/版本. 重新选设备 = 重置.
        wx.removeStorageSync('VPDevice');

        // S101 / iOS 场景: 系统层往往残留 "already connected" 状态,
        // 直接走 SDK connect API 会被短路 -> result.connection=true 但特征值未重新订阅
        // -> SDK 后续 password check / 电量 / 步数请求发出去都收不到 type=1/2/9 回复
        // -> 首页 MAC/版本/电量/步数全空.
        // 解决: 先强制 wx.closeBLEConnection 等 500ms 释放, 再走 SDK connect, 握手从零开始.
        // SDK 回调可能多次触发: 连接过程中先 connection=false (建连中),
        // 然后 connection=true (建连成功). 不能见到 false 就 toast 失败.
        // 用 settled flag 保证只处理第一次成功; 12s 都没成功才弹失败 toast.
        let settled = false;
        const failTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          wx.hideLoading();
          wx.showToast({ title: '连接超时,请重试', icon: 'none' });
        }, 12000);

        const doSdkConnect = () => {
          veepooBle.veepooWeiXinSDKBleConnectionServicesCharacteristicsNotifyManager(item, function (result: any) {
            console.log("result=>", result);
            if (settled) return;
            if (!result.connection) return; // 等下一次回调
            settled = true;
            clearTimeout(failTimer);

            // 订阅 notify (BleHub 已全局订阅, 这里把页面 listener 也加进去)
            self.notifyMonitorValueChange();
            // 强制 enable 所有 notify 特征值, 修 SDK 短路跳过订阅导致 type=1/2/9 回包丢失.
            setTimeout(() => {
              try { require('../../services/bleHub').bleHub.forceEnableNotify(item.deviceId); }
              catch (err) { console.warn('[bleConnection] forceEnableNotify 触发失败', err); }
            }, 300);
            // 密钥核准 (SDK 回 type=1 含 VPDeviceMAC/Version, 由 BleHub.handleAutoSync 抓 mac 入 storage).
            // 重发 3 次 (1.2s / 2.5s / 4s): iOS 上首发可能落在 forceEnableNotify 完成之前, 表不响应.
            setTimeout(() => { try { veepooFeature.veepooBlePasswordCheckManager(); console.log('[bleConnection] 密钥核准 #1'); } catch(e){} }, 1200);
            setTimeout(() => {
              if (wx.getStorageSync('VPDevice')) return;
              try { veepooFeature.veepooBlePasswordCheckManager(); console.log('[bleConnection] 密钥核准 #2 (VPDevice 仍空)'); } catch(e){}
            }, 2500);
            setTimeout(() => {
              if (wx.getStorageSync('VPDevice')) return;
              try { veepooFeature.veepooBlePasswordCheckManager(); console.log('[bleConnection] 密钥核准 #3 (VPDevice 仍空)'); } catch(e){}
            }, 4000);
            // 一键打开心率/血氧/体温自动监测开关 (出厂值不可信, 强写一次).
            // 放在密钥核准 #2/#3 之间, type=1 应已回, deviceId 内部上下文就绪.
            setTimeout(() => {
              try { require('../../services/bleHub').bleHub.enableAutoMonitoring(); }
              catch (err) { console.warn('[bleConnection] enableAutoMonitoring 失败', err); }
            }, 3000);
            // 拉手表 3 天本地缓存 (走 BleHub.handleAutoSync -> dataStorage.saveData -> pending -> 2h batch 上传)
            setTimeout(() => {
              try {
                const { bleHub } = require('../../services/bleHub');
                bleHub.pullHistoryFromWatch();
              } catch (err) { console.warn('[bleConnection] pullHistory 触发失败', err); }
            }, 5000);
            // 5.5s 缓冲后跳首页, 数据通道由 BleHub 接管, 首页 onShow 也会再 forceEnableNotify 兜一次.
            setTimeout(() => {
              wx.hideLoading();
              wx.redirectTo({ url: '/pages/index/index' });
            }, 5500);
          });
        };

        // 强制 close 一次再连. iOS CoreBluetooth 持有的 already-connected 状态
        // 是 SDK connect 短路的根因; close 后等 500ms 让系统真正释放.
        // 不论 close 成功失败都继续 (失败可能因为本来就没连, 那更好).
        try {
          wx.closeBLEConnection({
            deviceId: item.deviceId,
            complete: (cr: any) => {
              console.log('[bleConnection] 重置: 已 close, 等 500ms 后 connect', cr && cr.errMsg);
              setTimeout(doSdkConnect, 500);
            },
          });
        } catch (e) {
          console.warn('[bleConnection] 重置 close 抛错, 直接 connect:', e);
          setTimeout(doSdkConnect, 500);
        }
      }
    })
  },
  
  connectBle2() {
    let self = this;
    wx.showLoading({
      title: '连接中'
    })
    this.StopSearchBleManager()
    let item = wx.getStorageSync('bleInfo')
    veepooBle.veepooWeiXinSDKBleConnectionServicesCharacteristicsNotifyManager(item, function (result: any) {
      console.log("result=>", result)
      if (result.connection) {
        if (item.name == 'DFULang') {
          wx.hideLoading()
          // 获取当前服务，订阅监听
          self.notifyMonitorValueChange();
          setTimeout(() => {
            wx.redirectTo({
              url: '/pages/index/index'
            })
          }, 1000);
          return
        }
        // 获取当前服务，订阅监听
        self.notifyMonitorValueChange();
        // 蓝牙密码核准
        veepooFeature.veepooBlePasswordCheckManager();

        wx.hideLoading()
        wx.redirectTo({
          url: '/pages/index/index'
        })
        return
        let times = setInterval(() => {
          // 设备芯片
          let deviceChip = wx.getStorageSync('deviceChip');
          // 当前设备芯片获取状态  （通过调用蓝牙密码核准获取）
          let deviceChipStatus = wx.getStorageSync('deviceChipStatus')
          console.log("deviceChipStatus==>", deviceChipStatus)
          console.log("deviceChip==>", deviceChip)
          if (deviceChipStatus) {
            wx.hideLoading()
            wx.redirectTo({
              url: '/pages/index/index'
            })

            // 实际业务流程根据获取到的芯片类型添加相关js逻辑
            // if (deviceChip == 1) {
            //   console.log("杰里");
            // } else if (deviceChip == 2) {
            //   console.log("炬芯")
            // } else if (deviceChip == 3) {
            //   console.log("中科")
            // } else {
            //   console.log("Nordic/汇顶系列")
            // }

            clearInterval(times)
          }
        }, 1000)
      }


    })
  },
  // 监听订阅 notifyMonitorValueChange
  notifyMonitorValueChange() {
    let self = this;
    veepooBle.veepooWeiXinSDKNotifyMonitorValueChange(function (e: any) {
      console.log("监听蓝牙回调= 这个是连接页面>", e);
      self.bleDataParses(e)
    })
  },
  // 蓝牙连接状态变化监听（断开时清缓存）
  //
  // 重要: 这里曾经会调 tryAutoReconnect 自动重连, 但**这是 bug**:
  //   bleConnection 是 "用户来设备扫描页换设备" 的页面, 进 onLoad 会走完整 BLE
  //   adapter 重置流程 (closeBLEConnection + closeBluetoothAdapter + open). 重置
  //   过程中 BLE 状态变 disconnected -> 触发本回调 -> 自动重连把刚 reset 的 BLE
  //   又连回去 -> 表进 "paired-connected 不广播" 状态 -> 扫描搜不到 S101.
  //
  // 在设备扫描页, 断开是预期行为 (用户主动操作), 不要自动重连. app.ts onShow 的
  // 自动重连逻辑足够覆盖 "小程序后台 -> 前台" 场景, 不需要这里再重连一次.
  BLEConnectionStateChange() {
    veepooBle.veepooWeiXinSDKBLEConnectionStateChangeManager(function (e: any) {
      console.log("蓝牙连接状态变化=>", e)
      if (e && e.connected === false) {
        dataStorage.resetDeviceIdCache()
      }
    })
  },
  // 停止蓝牙搜索
  StopSearchBleManager() {
    veepooBle.veepooWeiXinSDKStopSearchBleManager(function (e: any) {
      console.log("停止蓝牙搜索=>", e)
    })
  },
  // 密钥核验  无参数
  BlePasswordCheckManager() {
    veepooFeature.veepooBlePasswordCheckManager()
  },
  // 电量读取
  ElectricQuantityManager() {
    veepooFeature.veepooReadElectricQuantityManager();
  },
  // 读取步数，距离卡路里
  /*
  参数：day:0； 0 今天 1 昨天 2 前天 
   */
  StepCalorieDistanceManager() {
    let data = {
      day: 0
    }
    veepooFeature.veepooReadStepCalorieDistanceManager(data)
  },
  // 监听蓝牙返回数据解析
  bleDataParses(value: any) {
    let content = value;
    console.log("content=>", content)
    // 全局兜底：连接成功但跳转 index 之间的极短窗口若有数据推送也能落库 + 上传
    dispatchBleData(value)
  }
})