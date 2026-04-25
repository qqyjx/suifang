// pages/bleConnection/index.ts
import { veepooBle, veepooFeature } from '../../miniprogram_dist/index'
import { dataStorage } from '../../services/dataStorage'
import { ENV } from '../../services/env'

const SCAN_TIMEOUT_MS = 30000








Page({

  /**
   * 页面的初始数据
   */
  data: {
    bleList: [],
    isIOS: false
  },

  scanTimer: 0 as any,

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad() {
    let self = this;
    wx.getSystemInfo({
      success: function (res) {
        if (res.platform == "ios") {
          self.setData({
            isIOS: true
          })

        }
      }
    });
    this.veepooSDKGetSetting()
    // 挂载断线监听（连接成功后，掉线时自动重连 + 清 deviceId 缓存）
    this.BLEConnectionStateChange()
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
    // 获取手机设置状态
    veepooBle.veepooWeiXinSDKStartScanDeviceAndReceiveScanningDevice(function (res: any) {
      const device = res && res[0]
      if (!device || !device.name) return
      // 过滤 1：弱信号（医院 100 表场景，避免列出隔壁房间的）
      if (typeof device.RSSI === 'number' && device.RSSI < ENV.MIN_BLE_RSSI) return
      // 过滤 2：设备名前缀白名单（VP-W680 / S101 / VPR04 等兼容机型）
      const matched = ENV.SUPPORTED_DEVICE_PREFIXES.some(p => device.name.startsWith(p))
      if (!matched) return
      // 同 deviceId 去重（SDK 可能重复回调）
      if (arr.find((d: any) => d.deviceId === device.deviceId)) return
      arr.push(device)
      self.setData({
        bleList: arr.sort((a: any, b: any) => b.RSSI - a.RSSI)
      })
    })
    // 扫描超时自动停止（防患者放下手机后扫描跑一夜耗电）
    if (this.scanTimer) clearTimeout(this.scanTimer)
    this.scanTimer = setTimeout(() => {
      self.StopSearchBleManager()
      wx.showToast({ title: '扫描结束，未找到请重试', icon: 'none' })
    }, SCAN_TIMEOUT_MS)
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
        veepooBle.veepooWeiXinSDKBleConnectionServicesCharacteristicsNotifyManager(item, function (result: any) {
          console.log("result=>", result)
          if (result.connection) {
            // 获取当前服务，订阅监听
            self.notifyMonitorValueChange();
            console.log("232323")
            // 蓝牙密码核准
            console.log("3q243")

            setTimeout(() => {
              veepooFeature.veepooBlePasswordCheckManager();
            }, 500);

            let times = setInterval(() => {
              // 设备芯片
              // 当前设备芯片获取状态  （通过调用蓝牙密码核准设置， 获取）
              let deviceChipStatus = wx.getStorageSync('deviceChipStatus')

              console.log("deviceChipStatus===>", deviceChipStatus)
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
  }
})