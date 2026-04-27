/**
 * BLE 全局事件中心 (BleHub)
 *
 * 解决两个核心问题:
 *   (1) Veepoo SDK 的 notifyMonitorValueChange 是 single-listener,
 *       多个页面同时订阅会互相覆盖, 全局监听拿不到事件.
 *       BleHub monkey-patch SDK 函数, 让所有调用变成注册到 hub,
 *       hub 再统一向 SDK 注册一次真实回调, 多 listener 共存.
 *
 *   (2) 用户在手表上测量后, 不会主动打开小程序对应页面去采集.
 *       必须有一个全局兜底:
 *         - 实时推送阶段: 不论用户在哪个页面, hub 自动 saveData
 *         - 离线缓存阶段: 重连成功时, hub 主动调用 SDK 拉历史
 *           (Veepoo 手表本地缓存最近 3 天日常数据)
 *
 * 顺带做的事:
 *   - 从 type=1 (蓝牙密码核准) 回调里抓取 VPDeviceMAC, 写入 bleInfo.mac
 *     供 dataStorage.resolveDeviceId() 用真 MAC 当 device_sign,
 *     避免 iOS UUID 飘逸导致同表多行.
 */

import { veepooBle, veepooFeature } from '../miniprogram_dist/index';
import { dataStorage } from './dataStorage';
import { HealthDataType } from '../types/healthData';

type Listener = (e: any) => void;

class BleHub {
  private listeners: Listener[] = [];
  private ecgListeners: Listener[] = [];
  private initialized = false;
  private lastPullAt = 0;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    // monitor 通道 (体征/设置类全部)
    veepooBle.veepooWeiXinSDKNotifyMonitorValueChange((e: any) => this.dispatch(this.listeners, e));
    veepooBle.veepooWeiXinSDKNotifyMonitorValueChange = (cb: Listener) => { this.listeners.push(cb); };
    this.listeners.push((e: any) => this.handleAutoSync(e));

    // ECG 通道 (心率 type=51, ECG 波形 持续 push)
    // 波形数据量大且需要 totalArray 累积, 留给 ecgTest 页面处理 (页面 push 自己的 totalArray);
    // 心率 type=51 在 hub 自动 saveData, 不依赖用户进 heartRateTest 页面.
    veepooBle.veepooWeiXinSDKNotifyECGValueChange((e: any) => this.dispatch(this.ecgListeners, e));
    veepooBle.veepooWeiXinSDKNotifyECGValueChange = (cb: Listener) => { this.ecgListeners.push(cb); };
    this.ecgListeners.push((e: any) => this.handleEcgChannel(e));

    console.log('[BleHub] 全局事件中心已初始化 (monitor+ecg 两通道)');
  }

  private dispatch(list: Listener[], e: any): void {
    for (const fn of list) {
      try { fn(e); } catch (err) { console.warn('[BleHub] listener 异常', err); }
    }
  }

  /**
   * ECG 通道自动同步:
   *   - type=51 心率值 -> heartRate 表
   *   - 'ecg波形数据' 不在这里 saveData (波形需要累积, 由 ecgTest 页面处理)
   *   - 'ecg测量' 完成 (progress=100) 不在这里 saveData (同上, 缺 totalArray)
   */
  private handleEcgChannel(e: any): void {
    if (!e || typeof e.type === 'undefined') return;
    if (e.type !== 51) return;
    const hr = e.content?.heartRate;
    if (typeof hr !== 'number' || hr === 0) return;
    console.log(`[BleHub] ECG 通道自动同步 type=51 -> heartRate=${hr}`);
    dataStorage.saveData('heartRate', { heartRate: hr, heartState: e.content?.heartState || 0 });
  }

  /**
   * 自动同步路由
   * 仅处理 "手表主动测量产生的体征数据" 与 type=1 的 MAC 抓取,
   * 设置类回调 (type 2/10/11/12/13/17/19/20/24/25/26/28/90 等) 直接忽略.
   */
  private handleAutoSync(e: any): void {
    if (!e || typeof e.type === 'undefined') return;
    const c = e.content || {};

    if (e.type === 1) {
      const mac = c.VPDeviceMAC;
      if (mac && typeof mac === 'string') {
        const info: any = wx.getStorageSync('bleInfo') || {};
        if (info.mac !== mac) {
          info.mac = mac;
          wx.setStorageSync('bleInfo', info);
          dataStorage.resetDeviceIdCache();
          console.log(`[BleHub] 捕获手表 MAC=${mac}, 已写入 bleInfo.mac`);
        }
      }
      return;
    }

    let dataType: HealthDataType | null = null;
    let payload: any = null;

    switch (e.type) {
      case 9:
        dataType = 'step';
        payload = {
          step: c.step || 0,
          calorie: c.calorie || 0,
          distance: c.distance || 0,
        };
        break;

      case 18:
        if (typeof c.bloodPressureHigh !== 'number' && typeof c.bloodPressureLow !== 'number') return;
        dataType = 'bloodPressure';
        payload = {
          systolic: c.bloodPressureHigh || 0,
          diastolic: c.bloodPressureLow || 0,
          heartRate: c.heartRate || 0,
          measureStatus: c.measureStatus || 0,
        };
        break;

      case 51:
        if (typeof c.heartRate !== 'number') return;
        dataType = 'heartRate';
        payload = {
          heartRate: c.heartRate || 0,
          heartState: c.heartState || 0,
        };
        break;

      case 6:
      case 7:
        if (typeof c.bodyTemperature !== 'number' || c.bodyTemperature === 0) return;
        dataType = 'temperature';
        payload = {
          bodyTemperature: c.bodyTemperature,
          skinTemperature: c.skinTemperature || 0,
          temperatureUnit: c.temperatureUnit || 'celsius',
        };
        break;

      case 30:
      case 31:
        if (typeof c.bloodOxygen !== 'number' || c.bloodOxygen === 0) return;
        dataType = 'bloodOxygen';
        payload = {
          bloodOxygen: c.bloodOxygen,
          heartRate: c.heartRate || 0,
          allDayData: c.allDayData || [],
        };
        break;

      case 37:
      case 38:
        if (typeof c.bloodGlucose !== 'number' || c.bloodGlucose === 0) return;
        dataType = 'bloodGlucose';
        payload = {
          bloodGlucose: c.bloodGlucose,
          measureTime: c.measureTime || '',
        };
        break;

      case 39:
      case 40:
        dataType = 'bloodLiquid';
        payload = {
          uricAcid: c.uricAcid || 0,
          cholesterol: c.cholesterol || 0,
          triacylglycerol: c.triacylglycerol || 0,
          highDensity: c.highDensity || 0,
          lowDensity: c.lowDensity || 0,
        };
        break;

      case 32:
        if (typeof c.weight !== 'number' || c.weight === 0) return;
        dataType = 'bodyComposition';
        payload = {
          weight: c.weight,
          bmi: c.bmi || 0,
          bodyFatRate: c.bodyFatRate || 0,
          muscleRate: c.muscleRate || 0,
          moisture: c.moisture || 0,
          boneMass: c.boneMass || 0,
          visceralFat: c.visceralFat || 0,
          basalMetabolism: c.basalMetabolism || 0,
          proteinRate: c.proteinRate || 0,
          bodyAge: c.bodyAge || 0,
        };
        break;

      case 42:
        if (e.Progress !== 100 && e.progress !== 100) return;
        dataType = 'ecg';
        payload = {
          heartRate: c.heartRate || 0,
          hrvValue: c.hrvValue || 0,
          diseaseResult: c.diseaseResult || [],
          measureDuration: c.measureDuration || 0,
        };
        break;

      case 4:
        if (!c.fallAsleepTime && !c.wakeUpTime) return;
        dataType = 'sleep';
        payload = {
          fallAsleepTime: c.fallAsleepTime || '',
          wakeUpTime: c.wakeUpTime || '',
          deepSleepTime: c.deepSleepTime || 0,
          lightSleepTime: c.lightSleepTime || 0,
          sleepQuality: c.sleepQuality || 0,
          sleepCurve: c.sleepCurve || [],
        };
        break;

      case 5:
        if ((e.Progress !== 100 && e.progress !== 100) || !Array.isArray(c)) return;
        dataType = 'daily';
        payload = { dailyRecords: c };
        break;

      default:
        return;
    }

    if (dataType && payload) {
      console.log(`[BleHub] 自动同步 type=${e.type} -> ${dataType}`);
      dataStorage.saveData(dataType, payload);
    }
  }

  /**
   * 重连成功后调用:
   *   把手表本地缓存的 3 天日常数据 (步数/血压/血氧/血糖/体温...) 全部拉回来,
   *   回调走 handleAutoSync -> dataStorage.saveData -> HTTP 上传到生产 MySQL.
   *
   * 5 秒节流, 防止 onShow 反复触发引起 BLE 拥塞.
   */
  pullHistoryFromWatch(): void {
    const now = Date.now();
    if (now - this.lastPullAt < 5000) {
      console.log('[BleHub] pullHistoryFromWatch 节流跳过');
      return;
    }
    this.lastPullAt = now;

    // 1) 日常汇总 (步数/睡眠/卡路里 等聚合, 走 type=5/9 回包)
    [0, 1, 2].forEach((day, i) => {
      setTimeout(() => {
        try {
          veepooFeature.veepooSendReadDailyDataManager({ day, package: 1 });
          console.log(`[BleHub] 触发拉日常汇总 day=${day}`);
        } catch (err) {
          console.warn(`[BleHub] 拉日常汇总 day=${day} 失败:`, err);
        }
      }, i * 2000);
    });

    // 2) 手动测量 (用户在手表上手动按键测的血压/心率/血氧/体温/血糖/HRV/血液成分).
    //    日常汇总不含手动测量的瞬时记录, 必须用 SendManualMeasurementDataRead 单独拉.
    //    "走开 → 任何时刻打开小程序 → 自动补齐到生产 MySQL" 的核心环节.
    const dataTypes = [
      { id: 0, name: '血压' },
      { id: 1, name: '心率' },
      { id: 2, name: '血糖' },
      { id: 4, name: '血氧' },
      { id: 5, name: '体温' },
      { id: 7, name: 'HRV' },
      { id: 8, name: '血液成分' },
    ];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ts = Math.floor(today.getTime() / 1000);
    dataTypes.forEach((dt, i) => {
      setTimeout(() => {
        try {
          veepooFeature.veepooSendManualMeasurementDataReadManager({
            timestamp: ts,
            dataType: dt.id,
          });
          console.log(`[BleHub] 触发拉手动测量 ${dt.name} dataType=${dt.id}`);
        } catch (err) {
          console.warn(`[BleHub] 拉手动测量 ${dt.name} 失败:`, err);
        }
      }, 6500 + i * 1200);
    });
  }
}

export const bleHub = new BleHub();
