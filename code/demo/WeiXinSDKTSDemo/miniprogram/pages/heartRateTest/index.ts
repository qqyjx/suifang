// pages/heartRateTest/index.ts
import { veepooBle, veepooFeature } from '../../miniprogram_dist/index'
import { dataStorage } from '../../services/dataStorage'

Page({

  /**
   * 页面的初始数据
   */
  data: {
    heartRate:0
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
    this.notifyMonitorValueChange();
  },
  // 监听订阅 notifyMonitorValueChange
  notifyMonitorValueChange() {
    let self = this;
    veepooBle.veepooWeiXinSDKNotifyECGValueChange(function (e: any) {
      console.log(" ECG 监听蓝牙回调=>", e);
      if(e.type == 51){

        self.setData({
          heartRate:e.content.heartRate
        })

        // 保存心率数据
        const heartRateData = {
          heartRate: e.content.heartRate || 0,
          heartState: e.content.heartState || 0
        }
        dataStorage.saveData('heartRate', heartRateData)
      }
    })
  },

  heartRateStart() {
    veepooFeature.veepooSendHeartRateTestSwitchManager({switch:true})
  },

  heartRateStop() {
    veepooFeature.veepooSendHeartRateTestSwitchManager({switch:false})
  }
})
