
import { veepooBle, veepooFeature } from '../../miniprogram_dist/index'
import { dataStorage } from '../../services/dataStorage'

Page({

  /**
   * 页面的初始数据
   */
  data: {
    deviceInfo: null,
    isTest: false
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {

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
    this.notifyMonitorValueChange()
  },
  TemperatureMeasurementSwitchManager() {
    let self = this;
    self.setData({
      isTest: true
    })
    let data = {
      switch: true
    }
    veepooFeature.veepooSendTemperatureMeasurementSwitchManager(data)
  },
  // 监听订阅 notifyMonitorValueChange
  notifyMonitorValueChange() {
    let self = this;
    veepooBle.veepooWeiXinSDKNotifyMonitorValueChange(function (e: any) {
      console.log("体温自动测量=>",e)
      if (e.type == 6) {
        if (e.content) {
          self.setData({
            isTest: false
          })
        }
        self.setData({
          deviceInfo: e
        })

        // 保存体温数据
        const temperatureData = {
          bodyTemperature: e.content?.bodyTemperature || 0,
          skinTemperature: e.content?.skinTemperature || 0,
          temperatureUnit: e.content?.temperatureUnit || 'celsius'
        }
        dataStorage.saveData('temperature', temperatureData)
      }


    })
  },

})
