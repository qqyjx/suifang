# 智能随访系统 — BLE SDK 数据采集全景

## 系统定位

基于 Veepoo BLE SDK 的微信小程序医疗级智能穿戴设备数据采集平台。通过蓝牙低功耗（BLE）协议连接可穿戴设备，自动采集生理体征数据，经结构化处理后存入 MySQL 数据库，并通过 REST API 供后端系统拉取。

---

## 支持的设备

| 设备 | 型号 | 佩戴方式 | 连接方式 | 采集能力 |
|------|------|---------|---------|---------|
| AMOLED 智能手表 | VP-W680 | 腕戴 | BLE 5.0 | 血压、体温、血糖、血液成分、身体成分、血氧、心率、步数、睡眠 |
| R04 蓝牙智能戒指 | R04 | 指戴 | BLE 4.2+ | 心率、血氧、HRV、压力、睡眠 |

Veepoo SDK 是**设备无关的通用协议层**，连接后通过功能汇总包自动识别该设备支持的采集能力。

---

## 采集的 11 类数据

### 数据类型详表

| 序号 | 数据类型 | 英文标识 | 采集字段 | 单位 | SDK 调用方法 |
|------|---------|---------|---------|------|-------------|
| 1 | 心率 | heartRate | heartRate, heartState | bpm | veepooSendHeartRateTestSwitchManager |
| 2 | 血氧 | bloodOxygen | bloodOxygen, [heartRate] | % | veepooSendBloodOxygenAutoTestDataManager |
| 3 | 血压 | bloodPressure | systolic, diastolic, [heartRate] | mmHg | 血压测量页面启动 |
| 4 | 体温 | temperature | temperature, [skinTemperature] | °C | veepooSendTemperatureMeasurementSwitchManager |
| 5 | 血糖 | bloodGlucose | bloodGlucose, mealState | mmol/L | veepooSendBloodGlucoseMeasurementDataManager |
| 6 | 血液成分 | bloodLiquid | uricAcid, cholesterol, triglyceride, HDL, LDL | mg/dL | 血液成分检测页面 |
| 7 | 身体成分 | bodyComposition | weight, BMI, bodyFat%, muscle, bone, water%, bmr, visceralFat | kg/% | veepooSendBodyCompositionTestStartDataManager |
| 8 | ECG | ecg | heartRate, ecgWaveform[], diseaseResult[], hrvData[] | bpm/mV | veepooSendECGmeasureStartDataManager |
| 9 | 步数 | step | step, calorie, distance | 步/cal/m | veepooReadStepCalorieDistanceManager |
| 10 | 睡眠 | sleep | fallAsleepTime, wakeUpTime, deepSleepMinutes, lightSleepMinutes, sleepQuality | min/% | veepooSendReadPreciseSleepManager |
| 11 | 日综合 | daily | 以上各项的日汇总 | 混合 | readDailyData 页面 |

### 数据结构示例

**心率数据**
```json
{
  "timestamp": "2026-03-16T10:19:56.205Z",
  "heartRate": 75,
  "heartState": 0
}
```

**血压数据**（含自动风险分级）
```json
{
  "timestamp": "2026-03-16T10:20:30.000Z",
  "systolic": 128,
  "diastolic": 82,
  "heartRate": 72
}
```
服务器自动分级：normal / elevated / hypertension_1 / hypertension_2 / crisis

**身体成分数据**
```json
{
  "timestamp": "2026-03-16T14:30:00.000Z",
  "weight": 68.5,
  "bmi": 22.3,
  "bodyFatRate": 18.2,
  "muscleMass": 52.1,
  "boneMass": 3.2,
  "waterRate": 55.8,
  "bmr": 1580,
  "visceralFat": 6
}
```

---

## 数据流水线

```
┌──────────────────────────────────────────────────────┐
│  Layer 1: 硬件设备                                     │
│  AMOLED 手表 / R04 戒指                                │
│  通过 BLE 私有协议 + 加密 发送二进制数据帧               │
└──────────────────────┬───────────────────────────────┘
                       ↓
┌──────────────────────────────────────────────────────┐
│  Layer 2: 微信小程序（采集层）                          │
│  wx.onBLECharacteristicValueChange() 接收原始数据       │
│  Veepoo SDK (378KB JS) 解析协议帧 → TypeScript 结构体    │
│  57 个功能页面触发各类采集                               │
└──────────────────────┬───────────────────────────────┘
                       ↓
┌──────────────────────────────────────────────────────┐
│  Layer 3: 本地存储（离线优先）                          │
│  dataStorage.saveData('heartRate', {heartRate: 75})    │
│  写入: health_data/2026-03-16/heartRate.json            │
│  每种数据类型一个 JSON 文件，按日期分目录                 │
│  断网时数据不丢失                                      │
└──────────────────────┬───────────────────────────────┘
                       ↓ 异步 HTTP POST
┌──────────────────────────────────────────────────────┐
│  Layer 4: Node.js 数据服务器（端口 3000）               │
│  接收 POST /api/health-data                            │
│  双写策略:                                             │
│    ① JSON 文件备份（服务端）                            │
│    ② MySQL 数据库写入                                  │
└──────────────────────┬───────────────────────────────┘
                       ↓
┌──────────────────────────────────────────────────────┐
│  Layer 5: MySQL 8.0 数据库                             │
│  数据库: smart_followup_research                       │
│                                                        │
│  心率 → vital_heart_rate 表（直接 INSERT）              │
│  血氧 → vital_blood_oxygen 表（直接 INSERT）            │
│  血压 → vital_blood_pressure 表（直接 INSERT + 风险分级）│
│  其余 8 种 → vital_signs 表（JSON 列存储）              │
│                                                        │
│  每次写入自动记录 data_sync_logs（含 FHIR 校验状态）     │
└──────────────────────┬───────────────────────────────┘
                       ↓
┌──────────────────────────────────────────────────────┐
│  Layer 6: REST API（供后端拉取）                        │
│                                                        │
│  GET /api/vitals/heart-rate    → 心率时序查询            │
│  GET /api/vitals/blood-oxygen  → 血氧数据查询            │
│  GET /api/vitals/blood-pressure → 血压+风险等级查询       │
│  GET /api/vitals/signs         → 通用体征 JSON 查询      │
│  GET /api/vitals/summary       → 各表数据量统计           │
│  GET /api/patients             → 受试者列表              │
│  GET /api/devices              → 设备列表                │
│  GET /api/status               → 服务器健康检查           │
└──────────────────────────────────────────────────────┘
```

---

## 数据库表结构

### 9 张表

| 表名 | 用途 | 字段概要 | 当前数据量 |
|------|------|---------|-----------|
| research_cohorts | 研究队列定义 | cohort_name, description | 2 |
| patients | 受试者信息 | name, age, gender, cohort_id | 5 |
| medical_devices | 医疗器械设备 | device_name, model, registration_cert | 8 |
| vital_heart_rate | 心率数据 | patient_id, heart_rate, heart_state, recorded_at | 1,682 |
| vital_blood_oxygen | 血氧数据 | patient_id, spo2, recorded_at | 841 |
| vital_blood_pressure | 血压数据 | patient_id, systolic, diastolic, pulse_rate, risk_level | 211 |
| vital_signs | 综合体征（JSON） | patient_id, data_type, vital_data(JSON), recorded_at | 453 |
| data_sync_logs | 同步日志 | sync_channel, data_types, status, fhir_validated | 140 |
| structured_reports | 结构化报告 | report_type, report_data(JSON) | 80 |

### 数据写入路由

```
heartRate     ──→ vital_heart_rate（直接 INSERT）
bloodOxygen   ──→ vital_blood_oxygen（直接 INSERT）
bloodPressure ──→ vital_blood_pressure（直接 INSERT + classifyBPRisk()）

temperature      ┐
bloodGlucose     │
sleep            │
step             ├──→ vital_signs（JSON 列，data_type 区分）
ecg              │
bloodLiquid      │
bodyComposition  │
daily            ┘
```

---

## REST API 接口

### 数据写入

| 方法 | 端点 | Body | 说明 |
|------|------|------|------|
| POST | /api/health-data | `{dataType, data, date, patientId?, deviceId?}` | 写入一条体征记录 |

### 数据查询

| 方法 | 端点 | 参数 | 说明 |
|------|------|------|------|
| GET | /api/vitals/heart-rate | patient_id, start, end, limit | 心率时序 |
| GET | /api/vitals/blood-oxygen | patient_id, start, end, limit | 血氧数据 |
| GET | /api/vitals/blood-pressure | patient_id, start, end, limit | 血压+风险等级 |
| GET | /api/vitals/signs | patient_id, data_type, start, end, limit | 通用体征 |
| GET | /api/vitals/reports | patient_id, report_type, limit | 结构化报告 |
| GET | /api/vitals/summary | — | 各表记录数统计 |
| GET | /api/patients | — | 受试者列表 |
| GET | /api/devices | — | 设备列表 |
| GET | /api/status | — | 服务器健康状态 |

### 查询示例

```bash
# 查询患者 1 最近 50 条心率
curl "http://localhost:3000/api/vitals/heart-rate?patient_id=1&limit=50"

# 查询 3 月份血压数据
curl "http://localhost:3000/api/vitals/blood-pressure?start=2026-03-01&end=2026-03-31"

# 查询体温数据
curl "http://localhost:3000/api/vitals/signs?data_type=temperature&limit=20"

# 数据总量统计
curl "http://localhost:3000/api/vitals/summary"
```

---

## 关键技术点

1. **离线优先架构**：本地 JSON 文件先存，HTTP 同步后发，断网不丢数据
2. **设备无关协议**：Veepoo SDK 通过功能汇总包自动适配不同设备的采集能力
3. **双写策略**：服务端同时写 JSON 文件（备份）和 MySQL（查询），任一故障不影响另一个
4. **自动风险分级**：血压数据写入时自动按 AHA 标准分级（normal/elevated/hypertension_1/hypertension_2/crisis）
5. **FHIR 标准映射**：数据同步日志记录 FHIR 校验状态，为未来对接医院 HIS 系统预留接口

---

## 当前状态

| 维度 | 状态 |
|------|------|
| 数据管道代码 | ✅ 全链路打通（POST + MySQL + GET API） |
| 基线测试 | ✅ 5/5 PASS |
| 功能追踪 | 54 个功能点，14 已验证，40 待真机测试 |
| 真机测试 | ❌ 未开始（需连接手表 BLE 测试） |
| 生产部署 | ❌ 未开始（需 HTTPS + 正式服务器） |
