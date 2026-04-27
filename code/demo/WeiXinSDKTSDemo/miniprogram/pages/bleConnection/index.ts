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
    // 体验版下挂原生 onBluetoothDeviceFound 旁路监听，与 SDK 回调对照诊断
    if (ENV.IS_TEST_BUILD) this.attachRawBleDiagnostics()
    this.veepooSDKGetSetting()
    // 挂载断线监听（连接成功后，掉线时自动重连 + 清 deviceId 缓存）
    this.BLEConnectionStateChange()
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
        veepooBle.veepooWeiXinSDKBleConnectionServicesCharacteristicsNotifyManager(item, function (result: any) {
          console.log("result=>", result)
          if (result.connection) {
            // 首次连接成功后, 把手表本地缓存的 3 天数据拉回来一次 (BleHub 自动 saveData 上传).
            // 之后任意时刻 onShow 重连都会触发同样动作, 用户在表上自测的指标不会丢.
            setTimeout(() => {
              try {
                const { bleHub } = require('../../services/bleHub');
                bleHub.pullHistoryFromWatch();
              } catch (err) { console.warn('[bleConnection] pullHistory 触发失败', err); }
            }, 2000);

            // 获取当前服务，订阅监听
            self.notifyMonitorValueChange();
            console.log("232323")
            // 蓝牙密码核准
            console.log("3q243")

            setTimeout(() => {
              veepooFeature.veepooBlePasswordCheckManager();
            }, 500);

            // result.connection=true 已表示 BLE 物理通道+特征值订阅都已就绪,
            // MTU 协商和密钥核准 setTimeout 已发出, 后续 SDK 回调由 BleHub 全局接收.
            // 不再轮询 deviceChipStatus: 该 key 仅在中科芯片 (chip==3) 时被 SDK 写入,
            // 杰理/炬芯/Nordic 设备 (含 S101) 永远拿不到 -> setInterval 永等卡死.
            // 给密钥核准 + MTU 留 2.5s 缓冲后直接跳首页, 数据通道已由 BleHub 接管.
            setTimeout(() => {
              wx.hideLoading();
              wx.redirectTo({ url: '/pages/index/index' });
            }, 2500);
          }


        })
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
  // 蓝牙连接状态变化监听（断开时清缓存 + 触发自动重连）
  BLEConnectionStateChange() {
    let self = this;
    veepooBle.veepooWeiXinSDKBLEConnectionStateChangeManager(function (e: any) {
      console.log("蓝牙连接状态变化=>", e)
      if (e && e.connected === false) {
        dataStorage.resetDeviceIdCache()
        self.tryAutoReconnect()
      }
    })
  },
  // 断线后自动重连（一次性尝试，失败则等用户手动操作）
  tryAutoReconnect() {
    const bleInfo: any = wx.getStorageSync('bleInfo')
    if (!bleInfo || !bleInfo.deviceId) return
    veepooBle.veepooWeiXinSDKBleReconnectDeviceManager(bleInfo, function (result: any) {
      console.log('[AutoReconnect] result=>', result)
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