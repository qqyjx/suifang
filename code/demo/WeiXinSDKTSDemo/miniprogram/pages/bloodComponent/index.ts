// pages/bloodComponent/index.ts
import { veepooBle, veepooFeature } from '../../miniprogram_dist/index'
import { dataStorage } from '../../services/dataStorage'

Page({

  /**
   * 页面的初始数据
   */
  data: {
    Blood: '',
    value1: 0,
    value2: 0,
    value3: 0,
    value4: 0,
    value5: 0,
    deviceSwitch: false
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad() {

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
  bindSwitchChange(e: any) {
    let self = this;
    self.setData({
      deviceSwitch: e.detail.value
    })
  },

  inputValue1(e: any) {
    this.setData({
      value1: e.detail.value
    })
  },
  inputValue2(e: any) {
    this.setData({
      value2: e.detail.value
    })
  },
  inputValue3(e: any) {
    this.setData({
      value3: e.detail.value
    })
  },
  inputValue4(e: any) {
    this.setData({
      value4: e.detail.value
    })
  },
  inputValue5(e: any) {
    this.setData({
      value5: e.detail.value
    })
  },
  // veepooSendBloodGlucoseMeasurementDataManager
  startTest() {
    let data = {
      switch: 'start',
      calibration: true,// true  使用校准模式 false 不适用校准模式
    }
    veepooFeature.veepooSendBloodComponentDataManager(data);
  },
  noCalibrationStartTest() {
    let data = {
      switch: 'start',
      calibration: false,// true  使用校准模式 false 不适用校准模式
    }
    veepooFeature.veepooSendBloodComponentDataManager(data);
  },
  stopTest() {
    let data = {
      switch: 'stop',
      calibration: true,// true  使用校准模式 false 不适用校准模式
    }
    veepooFeature.veepooSendBloodComponentDataManager(data);
  },

  startCheckTest() {
    let self = this;
    let data = {
      deviceControl: 'setup',
      switch: self.data.deviceSwitch ? 'start' : 'stop',
      uricAcidVal: self.data.value1,
      cholesterol: self.data.value2,
      triacylglycerol: self.data.value3,
      highDensity: self.data.value4,
      lowDensity: self.data.value5
    }

    console.log("data=>",data);

    veepooFeature.veepooSendBloodComponentCheckDataManager(data);
  },
  readCheckTest() {
    let self = this;
    let data = {
      deviceControl: 'read',
      switch: self.data.deviceSwitch,
      uricAcidVal: self.data.value1,
      cholesterol: self.data.value2,
      triacylglycerol: self.data.value3,
      highDensity: self.data.value4,
      lowDensity: self.data.value5
    }
    console.log("data==>", data)
    veepooFeature.veepooSendBloodComponentCheckDataManager(data);
  },

  // 监听订阅 notifyMonitorValueChange
  notifyMonitorValueChange() {
    let self = this;
    veepooBle.veepooWeiXinSDKNotifyMonitorValueChange(function (e: any) {
      console.log("监听蓝牙回调=>", e);
      self.setData({
        Blood: e
      })

      // 保存血液成分数据
      if (e.type == 39 || e.type == 40) {
        const bloodLiquidData = {
          uricAcid: e.content?.uricAcid || 0,
          cholesterol: e.content?.cholesterol || 0,
          triacylglycerol: e.content?.triacylglycerol || 0,
          highDensity: e.content?.highDensity || 0,
          lowDensity: e.content?.lowDensity || 0
        }
        dataStorage.saveData('bloodLiquid', bloodLiquidData)
      }
    })
  },

})
