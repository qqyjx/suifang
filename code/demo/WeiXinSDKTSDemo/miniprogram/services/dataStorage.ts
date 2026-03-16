/**
 * 数据存储服务
 * 负责将健康数据保存到小程序文件系统，并尝试同步到WSL本地HTTP服务器
 */

import {
  HealthDataType,
  StepData,
  SleepData,
  HeartRateData,
  BloodOxygenData,
  BloodPressureData,
  TemperatureData,
  ECGData,
  BloodGlucoseData,
  BloodLiquidData,
  BodyCompositionData,
  DailyData,
  HealthRecord,
  DataFileContent
} from '../types/healthData';

// WSL HTTP服务器地址（开发时使用）
const WSL_SERVER_URL = 'http://127.0.0.1:3000';

// 数据存储根目录
const DATA_ROOT = `${wx.env.USER_DATA_PATH}/health_data`;

class DataStorageService {
  private fs: WechatMiniprogram.FileSystemManager;
  private httpEnabled: boolean = true;

  constructor() {
    this.fs = wx.getFileSystemManager();
    this.initDataDirectory();
  }

  /**
   * 初始化数据目录
   */
  private initDataDirectory(): void {
    try {
      this.fs.accessSync(DATA_ROOT);
    } catch (e) {
      try {
        this.fs.mkdirSync(DATA_ROOT, true);
        console.log('[DataStorage] 数据目录创建成功:', DATA_ROOT);
      } catch (err) {
        console.error('[DataStorage] 创建数据目录失败:', err);
      }
    }
  }

  /**
   * 获取当前日期字符串 (YYYY-MM-DD)
   */
  private getDateString(date?: Date): string {
    const d = date || new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 获取ISO格式时间戳
   */
  private getTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * 获取日期数据目录路径
   */
  private getDateDir(date?: string): string {
    const dateStr = date || this.getDateString();
    return `${DATA_ROOT}/${dateStr}`;
  }

  /**
   * 确保日期目录存在
   */
  private ensureDateDir(date?: string): string {
    const dateDir = this.getDateDir(date);
    try {
      this.fs.accessSync(dateDir);
    } catch (e) {
      try {
        this.fs.mkdirSync(dateDir, true);
      } catch (err) {
        console.error('[DataStorage] 创建日期目录失败:', err);
      }
    }
    return dateDir;
  }

  /**
   * 获取数据类型对应的文件名
   */
  private getFileName(type: HealthDataType): string {
    const fileNames: Record<HealthDataType, string> = {
      step: 'step.json',
      sleep: 'sleep.json',
      heartRate: 'heartRate.json',
      bloodOxygen: 'bloodOxygen.json',
      bloodPressure: 'bloodPressure.json',
      temperature: 'temperature.json',
      ecg: 'ecg.json',
      bloodGlucose: 'bloodGlucose.json',
      bloodLiquid: 'bloodLiquid.json',
      bodyComposition: 'bodyComposition.json',
      daily: 'daily.json'
    };
    return fileNames[type];
  }

  /**
   * 读取数据文件
   */
  private readDataFile<T>(filePath: string): DataFileContent<T> | null {
    try {
      const content = this.fs.readFileSync(filePath, 'utf8') as string;
      return JSON.parse(content) as DataFileContent<T>;
    } catch (e) {
      return null;
    }
  }

  /**
   * 写入数据文件
   */
  private writeDataFile<T>(filePath: string, data: DataFileContent<T>): boolean {
    try {
      this.fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('[DataStorage] 写入文件失败:', e);
      return false;
    }
  }

  /**
   * 保存健康数据（核心方法）
   * @param type 数据类型
   * @param data 数据内容
   * @param date 可选日期，默认为今天
   */
  async saveData<T extends HealthRecord>(
    type: HealthDataType,
    data: Omit<T, 'timestamp'>,
    date?: string
  ): Promise<boolean> {
    const dateStr = date || this.getDateString();
    const dateDir = this.ensureDateDir(dateStr);
    const fileName = this.getFileName(type);
    const filePath = `${dateDir}/${fileName}`;

    // 添加时间戳
    const record: T = {
      ...data,
      timestamp: this.getTimestamp()
    } as T;

    // 读取现有数据或创建新文件
    let fileContent = this.readDataFile<T>(filePath);
    if (!fileContent) {
      fileContent = {
        date: dateStr,
        records: []
      };
    }

    // 添加新记录
    fileContent.records.push(record);
    fileContent.lastUpdated = this.getTimestamp();

    // 保存到本地文件系统
    const localSaved = this.writeDataFile(filePath, fileContent);

    // 尝试同步到WSL HTTP服务器
    if (this.httpEnabled) {
      this.syncToServer(type, record, dateStr);
    }

    console.log(`[DataStorage] 保存${type}数据:`, localSaved ? '成功' : '失败');
    return localSaved;
  }

  /**
   * 获取所有日期的所有数据
   */
  getAllData(): Record<string, Record<HealthDataType, DataFileContent<any> | null>> {
    const dates = this.getDateList();
    const allData: Record<string, Record<HealthDataType, DataFileContent<any> | null>> = {};
    for (const date of dates) {
      allData[date] = this.readDateData(date);
    }
    return allData;
  }

  /**
   * 同步数据到WSL HTTP服务器
   */
  private syncToServer<T>(type: HealthDataType, data: T, date: string): void {
    wx.request({
      url: `${WSL_SERVER_URL}/api/health-data`,
      method: 'POST',
      data: {
        dataType: type,
        data,
        date,
        patientId: 1,
        deviceId: 1
      },
      success: (res) => {
        console.log(`[DataStorage] HTTP同步${type}成功:`, res.data);
      },
      fail: (err) => {
        console.log(`[DataStorage] HTTP同步${type}失败(服务器可能未启动):`, err.errMsg);
      }
    });
  }

  /**
   * 保存步数数据
   */
  saveStepData(data: {
    step: number;
    calorie: number;
    distance: number;
  }): Promise<boolean> {
    return this.saveData<StepData>('step', data);
  }

  /**
   * 保存睡眠数据
   */
  saveSleepData(data: {
    fallAsleepTime?: string;
    wakeUpTime?: string;
    deepSleepMinutes: number;
    lightSleepMinutes: number;
    awakeTimes?: number;
    sleepQuality?: number;
    sleepCurve?: number[];
  }): Promise<boolean> {
    return this.saveData<SleepData>('sleep', data);
  }

  /**
   * 保存心率数据
   */
  saveHeartRateData(data: {
    heartRate: number;
    heartState?: number;
  }): Promise<boolean> {
    return this.saveData<HeartRateData>('heartRate', data);
  }

  /**
   * 保存血氧数据
   */
  saveBloodOxygenData(data: {
    bloodOxygen: number;
    heartRate?: number;
  }): Promise<boolean> {
    return this.saveData<BloodOxygenData>('bloodOxygen', data);
  }

  /**
   * 保存血压数据
   */
  saveBloodPressureData(data: {
    systolic: number;
    diastolic: number;
    heartRate?: number;
  }): Promise<boolean> {
    return this.saveData<BloodPressureData>('bloodPressure', data);
  }

  /**
   * 保存体温数据
   */
  saveTemperatureData(data: {
    temperature: number;
    unit?: 'celsius' | 'fahrenheit';
  }): Promise<boolean> {
    return this.saveData<TemperatureData>('temperature', data);
  }

  /**
   * 保存ECG数据
   */
  saveECGData(data: {
    heartRate: number;
    hrv?: number;
    waveformData?: number[];
    diseaseResult?: number[];
  }): Promise<boolean> {
    return this.saveData<ECGData>('ecg', data);
  }

  /**
   * 保存血糖数据
   */
  saveBloodGlucoseData(data: {
    bloodGlucose: number;
    unit?: 'mmol/L' | 'mg/dL';
    mealType?: 'fasting' | 'beforeMeal' | 'afterMeal' | 'random';
  }): Promise<boolean> {
    return this.saveData<BloodGlucoseData>('bloodGlucose', data);
  }

  /**
   * 保存血液成分数据
   */
  saveBloodLiquidData(data: {
    uricAcid?: number;
    cholesterol?: number;
    triglyceride?: number;
    hdl?: number;
    ldl?: number;
  }): Promise<boolean> {
    return this.saveData<BloodLiquidData>('bloodLiquid', data);
  }

  /**
   * 保存身体成分数据
   */
  saveBodyCompositionData(data: {
    weight?: number;
    bmi?: number;
    bodyFatRate?: number;
    muscleMass?: number;
    boneMass?: number;
    waterRate?: number;
    bmr?: number;
    visceralFat?: number;
  }): Promise<boolean> {
    return this.saveData<BodyCompositionData>('bodyComposition', data);
  }

  /**
   * 保存日常综合数据
   */
  saveDailyData(data: {
    step?: number;
    calorie?: number;
    distance?: number;
    heartRate?: number;
    bloodOxygen?: number;
    bloodPressure?: { systolic: number; diastolic: number };
    temperature?: number;
    rr50?: number[];
  }): Promise<boolean> {
    return this.saveData<DailyData>('daily', data);
  }

  /**
   * 读取指定日期的所有数据
   */
  readDateData(date?: string): Record<HealthDataType, DataFileContent<any> | null> {
    const dateStr = date || this.getDateString();
    const dateDir = this.getDateDir(dateStr);
    const types: HealthDataType[] = [
      'step', 'sleep', 'heartRate', 'bloodOxygen', 'bloodPressure',
      'temperature', 'ecg', 'bloodGlucose', 'bloodLiquid', 'bodyComposition', 'daily'
    ];

    const result: Record<string, DataFileContent<any> | null> = {};
    for (const type of types) {
      const fileName = this.getFileName(type);
      const filePath = `${dateDir}/${fileName}`;
      result[type] = this.readDataFile(filePath);
    }

    return result as Record<HealthDataType, DataFileContent<any> | null>;
  }

  /**
   * 读取指定类型的数据
   */
  readTypeData<T>(type: HealthDataType, date?: string): DataFileContent<T> | null {
    const dateStr = date || this.getDateString();
    const dateDir = this.getDateDir(dateStr);
    const fileName = this.getFileName(type);
    const filePath = `${dateDir}/${fileName}`;
    return this.readDataFile<T>(filePath);
  }

  /**
   * 获取所有已保存的日期列表
   */
  getDateList(): string[] {
    try {
      const files = this.fs.readdirSync(DATA_ROOT);
      // 过滤出日期格式的目录 (YYYY-MM-DD)
      return files.filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort().reverse();
    } catch (e) {
      return [];
    }
  }

  /**
   * 导出所有数据为JSON
   */
  exportAllData(): string {
    const dates = this.getDateList();
    const allData: Record<string, Record<HealthDataType, DataFileContent<any> | null>> = {};

    for (const date of dates) {
      allData[date] = this.readDateData(date);
    }

    return JSON.stringify({
      exportTime: this.getTimestamp(),
      data: allData
    }, null, 2);
  }

  /**
   * 清除指定日期的数据
   */
  clearDateData(date: string): boolean {
    const dateDir = this.getDateDir(date);
    try {
      const files = this.fs.readdirSync(dateDir);
      for (const file of files) {
        this.fs.unlinkSync(`${dateDir}/${file}`);
      }
      this.fs.rmdirSync(dateDir);
      return true;
    } catch (e) {
      console.error('[DataStorage] 清除数据失败:', e);
      return false;
    }
  }

  /**
   * 清除所有数据
   */
  clearAllData(): boolean {
    const dates = this.getDateList();
    let success = true;
    for (const date of dates) {
      if (!this.clearDateData(date)) {
        success = false;
      }
    }
    return success;
  }

  /**
   * 设置是否启用HTTP同步
   */
  setHttpEnabled(enabled: boolean): void {
    this.httpEnabled = enabled;
  }

  /**
   * 获取HTTP同步状态
   */
  isHttpEnabled(): boolean {
    return this.httpEnabled;
  }
}

// 导出单例
export const dataStorage = new DataStorageService();
export default dataStorage;
