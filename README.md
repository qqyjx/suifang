# 智能随访系统 — 可穿戴设备体征数据采集与结构化处理平台

基于 Veepoo BLE SDK 的微信小程序医疗级智能穿戴设备数据采集平台。Veepoo SDK 是**设备无关的通用协议层**，支持所有维亿魄 BLE 设备（戒指、手表、手环等），连接后通过功能汇总包自动识别该设备支持的采集能力。当前已集成 **2 款具备二类医疗器械注册证资质**的 Veepoo 可穿戴设备，实现 **11 类体征数据**的自动采集、JSON Schema 结构化校验、FHIR Resources 映射，并上传至 MySQL 研究队列数据库。后端团队通过 REST API 按需拉取所需数据。

---

## 目录

- [项目概述](#项目概述)
- [支持的二类医疗器械设备](#支持的二类医疗器械设备)
- [技术架构](#技术架构)
- [数据采集能力（11 类体征数据）](#数据采集能力11-类体征数据)
- [数据结构化处理流程](#数据结构化处理流程)
- [快速开始](#快速开始)
  - [环境要求](#环境要求)
  - [安装步骤](#安装步骤)
  - [启动数据同步服务器](#启动数据同步服务器)
  - [开发者工具配置](#开发者工具配置)
  - [使用流程](#使用流程)
- [WSL 开发环境配置](#wsl-开发环境配置)
- [项目结构](#项目结构)
- [数据同步服务器](#数据同步服务器)
- [REST API 文档](#rest-api-文档)
  - [数据写入](#数据写入)
  - [数据查询](#数据查询)
  - [管理接口](#管理接口)
- [数据库设计](#数据库设计)
- [BLE 连接与数据采集](#ble-连接与数据采集)
- [本地数据存储](#本地数据存储)
- [数据导出](#数据导出)
- [故障排除](#故障排除)
- [运行环境兼容性](#运行环境兼容性)
- [SDK 版本历史](#sdk-版本历史)
- [注意事项](#注意事项)
- [许可证](#许可证)

---

## 项目概述

本项目是"智能穿戴设备集成技术方案"的核心软件部分，实现了从可穿戴医疗设备到研究队列数据库的完整数据链路。系统设计遵循"采集端尽可能多存、后端按需拉取"的原则：小程序端采集设备能提供的所有体征数据并全量存入数据库，后端团队通过 REST API 自行选择需要的数据类型和时间范围。

**核心能力**：
- 接入 2 款 Veepoo 二类医疗器械设备，已通过通用 SDK 集成
- 采集 11 类体征数据，TypeScript 严格类型定义
- JSON Schema 结构化校验 + FHIR Resources 标准化映射
- 双重存储：本地 JSON 文件缓存 + MySQL 研究队列数据库
- 11 个 REST API 端点，支持按患者、时间范围、数据类型灵活查询

> 全部设备均持有**国家药品监督管理局颁发的二类医疗器械注册证**，满足临床研究数据采集合规要求。

---

## 支持的二类医疗器械设备

| 设备 | 型号 | 佩戴方式 | 生产厂商 | 注册证编号 | 采集指标 | 连接方式 | 状态 |
|------|------|---------|---------|-----------|---------|---------|------|
| R04 蓝牙智能戒指 | VPR04-BLE | 手指/腕戴式 | 深圳维亿魄科技 | 粤械注准20232070845 | 心率、血氧、HRV、压力、睡眠 | BLE 4.2+ | ✅ 已集成 |
| AMOLED 智能手表 | VP-W680 | 腕戴式 | 深圳维亿魄科技 | 粤械注准20242211536 | 血压、体温、血糖、血液成分、身体成分、血氧 | BLE 5.0 | ✅ 已集成 |
两款设备共享同一个 BLE SDK（`vp_sdk`，378KB JS），该 SDK 是**设备无关的通用协议层**——连接任何 Veepoo BLE 设备后，通过功能汇总包（Feature Summary Packet）自动识别该设备支持的数据类型，无需针对不同设备型号修改代码。

---

## 技术架构

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐     ┌──────────────┐
│   可穿戴设备层    │────→│  微信小程序采集层  │────→│  Node.js 数据服务器   │────→│ MySQL 研究队列 │
│                 │ BLE │                  │HTTP │                     │     │   数据库      │
│ R04 智能戒指    │     │ Veepoo SDK(378KB)│POST │ 端口 3000            │     │ 9 张业务表    │
│ AMOLED 手表     │     │ 57 个功能页面     │     │ JSON 文件存储        │     │ 3,395+ 条记录 │
│                 │     │ 11 类 TS 类型    │     │ MySQL 写入          │     │ FHIR 映射     │
│                 │     │ 本地数据缓存      │     │ REST API 查询       │     │ 结构化报告    │
└─────────────────┘     └──────────────────┘     └─────────────────────┘     └──────────────┘
                                                          │
                                                    REST API (GET)
                                                          │
                                                  ┌───────▼───────┐
                                                  │  后端团队按需   │
                                                  │  拉取数据      │
                                                  └───────────────┘
```

- **设备层**：2 款 Veepoo 二类医疗器械通过 BLE 协议通信，使用设备无关的 `vp_sdk`（378KB JS）封装私有协议，连接后自动识别设备能力
- **采集层**：57 个功能页面，TypeScript 开发，采集后先写本地 JSON 缓存，再自动 HTTP POST 同步
- **服务器层**：Node.js HTTP 服务器（端口 3000），双写策略：JSON 文件 + MySQL
- **数据库层**：MySQL 8.0，9 张表，FHIR Observation/DiagnosticReport 标准映射

---

## 数据采集能力（11 类体征数据）

| 序号 | 数据类型 | TypeScript 接口 | 关键字段 | 单位 | 采集频率 | 来源设备 |
|------|---------|----------------|---------|------|---------|---------|
| 1 | 心率 | `HeartRateRecord` | `heartRate`, `heartState` | bpm | 实时/每分钟 | Veepoo 设备（R04 戒指、手表等，取决于设备能力） |
| 2 | 血氧饱和度 | `BloodOxygenRecord` | `bloodOxygen` | % | 每 2 小时 | Veepoo 设备（R04 戒指、手表等） |
| 3 | 血压 | `BloodPressureRecord` | `systolic`, `diastolic` | mmHg | 早/中/晚 | Veepoo 设备（需设备支持血压传感器） |
| 4 | 体温 | `TemperatureRecord` | `temperature`, `skinTemperature` | °C | 每 4 小时 | Veepoo 设备（需设备支持温度传感器） |
| 5 | 心电图 ECG | `ECGRecord` | `heartRate`, `ecgWaveform[]`, `hrvData[]` | mV | 按需测量 | Veepoo 设备（需设备支持 ECG） |
| 6 | 血糖 | `BloodGlucoseRecord` | `bloodGlucose`, `mealState` | mmol/L | 餐前/餐后 | Veepoo 设备（需设备支持血糖传感器） |
| 7 | 血液成分 | `BloodLiquidRecord` | `uricAcid`, `cholesterol`, `triglyceride` | 多种 | 每日 | Veepoo 设备（需设备支持血液成分检测） |
| 8 | 身体成分 | `BodyCompositionRecord` | `bmi`, `bodyFat`, `muscle`, `water` | 多种 | 每日 | Veepoo 设备（需设备支持身体成分检测） |
| 9 | 步数 | `StepRecord` | `step`, `calorie`, `distance` | 步/cal/米 | 每日汇总 | Veepoo 设备（大部分设备支持） |
| 10 | 睡眠 | `SleepRecord` | `deepSleepTime`, `lightSleepTime`, `sleepQuality` | 分钟 | 每日汇总 | Veepoo 设备（需设备支持睡眠监测） |
| 11 | 日常综合 | `DailyRecord` | `step`, `heartRate`, `bloodOxygen`, `bloodPressure` | 多种 | 每日汇总 | 所有 Veepoo 设备（汇总当日可用数据） |

> **注意**：具体设备支持哪些数据类型取决于其硬件传感器配置。连接设备后 SDK 会返回功能汇总包，小程序据此自动显示该设备可用的采集页面。

所有类型在 `miniprogram/types/healthData.ts` 中严格定义，继承自 `BaseRecord`（含 ISO 8601 时间戳）。

---

## 数据结构化处理流程

```
BLE 原始字节流
    ↓
Veepoo SDK 协议解析 (vp_sdk/index.js, 378KB)
    ↓
TypeScript 类型实例化 (healthData.ts — 11 个接口校验)
    ↓
本地 JSON 文件缓存 (health_data/YYYY-MM-DD/{dataType}.json)
    ↓
HTTP POST → Node.js 服务器 (端口 3000)
    ├── JSON 文件持久化
    └── MySQL 写入 + FHIR 映射 + 同步日志
```

### FHIR 资源映射

| 体征数据 | FHIR Resource Type | LOINC Code |
|---------|-------------------|------------|
| 心率 | `Observation` | `8867-4` |
| 血氧 | `Observation` | `2708-6` |
| 血压 | `Observation` | `85354-9` |
| 体温 | `Observation` | `8310-5` |
| ECG | `Observation` | `131328` |
| 血糖 | `Observation` | `15074-8` |
| 睡眠 | `Observation` | `93832-4` |
| 步数 | `Observation` | `55423-8` |
| 结构化报告 | `DiagnosticReport` | — |

---

## 快速开始

### 环境要求

| 工具 | 版本 | 用途 |
|------|------|------|
| 微信开发者工具 | 最新稳定版 | 小程序编译调试 |
| Node.js | ≥ 16.x | 数据同步服务端 |
| MySQL | 8.0+ | 研究队列数据库 |
| 支持 BLE 的手机 | Android 5.0+ / iOS 10+ | 真机测试（模拟器不支持 BLE） |

### 安装步骤

```bash
# 1. 克隆项目
git clone <repository-url>
cd WeChat_Mini_Program_Ble_SDK

# 2. 初始化研究队列数据库（含 3,395 条演示数据）
echo "xyf" | sudo -S service mysql start
mysql -u root -phealth123 < database/init.sql

# 3. 安装服务器依赖并启动
cd scripts && npm install && node health-data-server.js
# 服务器将在 http://localhost:3000 运行

# 4. 在微信开发者工具中导入项目
#    项目路径：code/demo/WeiXinSDKTSDemo
#    AppID：wxbc5453a4c53dbee8
```

### 启动数据同步服务器

```bash
# 启动 MySQL
echo "xyf" | sudo -S service mysql start

# 启动服务器
cd /home/qq/WeChat_Mini_Program_Ble_SDK/scripts
node health-data-server.js

# 验证服务器运行
curl http://localhost:3000/api/status
# 期望输出: {"status":"running","timestamp":"...","mysqlEnabled":true,...}

# 查看所有可用 API 端点
curl http://localhost:3000/
```

### 开发者工具配置

1. **勾选**：不校验合法域名（本地开发必须）
2. **勾选**：增强编译
3. 基础库版本：≥ 3.8.9
4. 编译插件：TypeScript、LESS

### 使用流程

```
打开小程序 → 设备扫描 → 选择设备连接 → 密钥认证 → 进入功能页面
                                                      ↓
              ← 数据自动同步至服务端 ← 采集体征数据 ←──┘
```

---

## WSL 开发环境配置

本项目运行在 WSL (Windows Subsystem for Linux) 环境中，配合 Windows 版微信开发者工具使用。

### 工具分工

| 工具 | 运行环境 | 用途 |
|------|----------|------|
| VSCode | WSL | 代码编写、文件管理、Git 操作 |
| 微信开发者工具 | Windows | 预览、模拟器、真机调试、蓝牙测试 |

### 项目导入路径

在微信开发者工具的"导入项目"中，项目目录使用 WSL 网络路径：

```
\\wsl$\Ubuntu\home\qq\WeChat_Mini_Program_Ble_SDK\code\demo\WeiXinSDKTSDemo
```

或：

```
\\wsl.localhost\Ubuntu\home\qq\WeChat_Mini_Program_Ble_SDK\code\demo\WeiXinSDKTSDemo
```

### 开发工作流

```
WSL VSCode 编辑代码 → 保存 → Windows 微信开发者工具自动热重载 → 查看效果/真机调试
```

### 推荐 VSCode 扩展

- **WXML - Language Services** — WXML 语法支持
- **TypeScript** — TS 支持（内置）
- **ESLint** — 代码检查
- **WSL** — WSL 远程开发支持

### 真机调试

蓝牙功能无法在模拟器中测试，必须使用真机。在开发者工具点击"预览"或"真机调试"，手机扫码后需确保开启蓝牙、定位和微信蓝牙权限。

---

## 项目结构

```
WeChat_Mini_Program_Ble_SDK/
├── README.md                          # 本文件
├── CLAUDE.md                          # 项目配置（Claude Code agent 工作流）
├── 智能随访说明.md                     # 完整系统说明文档
├── SDK功能清单.md                      # 全部功能清单
├── 开发环境使用指南.md                  # WSL + 微信开发者工具配置指南
├── init.sh                            # 环境初始化诊断脚本
├── task.json                          # 结构化任务列表
├── claude-progress.txt                # 跨 session 进度日志
│
├── code/demo/WeiXinSDKTSDemo/         # 微信小程序主项目
│   ├── miniprogram/
│   │   ├── pages/                     # 57 个功能页面
│   │   │   ├── bleConnection/         # BLE 设备扫描与连接（入口页）
│   │   │   ├── heartRateTest/         # 心率实时测量
│   │   │   ├── bloodOxygen/           # 血氧监测
│   │   │   ├── bloodPressure/         # 血压测量
│   │   │   ├── bodyTemperature/       # 体温监测
│   │   │   ├── ecgTest/               # ECG 心电图测量
│   │   │   ├── bloodGlucose/          # 血糖监测
│   │   │   ├── bloodComponent/        # 血液成分分析
│   │   │   ├── bodyMeasurement/       # 身体成分测量
│   │   │   ├── step/                  # 步数统计
│   │   │   ├── sleep/                 # 睡眠分析
│   │   │   ├── readDailyData/         # 日常综合数据
│   │   │   ├── dataManagement/        # 数据导出管理
│   │   │   ├── ota/                   # OTA 固件升级
│   │   │   ├── dial/                  # 表盘管理
│   │   │   └── ...                    # 更多功能页面
│   │   ├── services/
│   │   │   ├── dataStorage.ts         # 数据存储 + HTTP 同步（端口 3000）
│   │   │   ├── dataExport.ts          # 数据导出（JSON 文件 + 微信分享）
│   │   │   └── httpSync.ts            # HTTP 同步服务（遗留，端口 3456）
│   │   ├── types/
│   │   │   └── healthData.ts          # 11 种体征数据 TypeScript 接口定义
│   │   ├── jieli_sdk/                 # 杰理 BLE SDK（OTA/表盘传输）
│   │   └── app.ts                     # 小程序入口
│   ├── project.config.json            # 小程序配置（AppID: wxbc5453a4c53dbee8）
│   └── tsconfig.json                  # TypeScript 配置
│
├── libs/
│   ├── vp_sdk/                        # Veepoo BLE SDK（编译后 JS，378KB）
│   │   ├── index.js                   # SDK 主文件
│   │   └── index.d.ts                 # TypeScript 类型声明
│   └── jieli_sdk/                     # 杰理 BLE SDK
│       ├── index.ts                   # SDK 入口
│       ├── bleInit.ts                 # BLE 初始化
│       └── jl_lib/                    # RCSP 协议、认证、OTA
│
├── scripts/
│   ├── health-data-server.js          # Node.js 数据同步 + REST API 服务器（端口 3000）
│   ├── package.json                   # Node.js 依赖（mysql2）
│   └── node_modules/                  # 依赖包
│
├── database/
│   ├── init.sql                       # 完整数据库（建表 + 3,395 条演示数据）
│   └── schema.sql                     # 仅表结构（不含数据）
│
├── health_data/                       # 本地 JSON 数据存储（按日期组织）
│   └── 2026-03-14/
│       ├── heartRate.json
│       ├── bloodOxygen.json
│       ├── sleep.json
│       └── ...
│
└── docs/
    ├── VeepooWeiXinSDK使用文档.md     # SDK 完整 API 文档（5,600+ 行）
    └── txt/                           # HRV、睡眠数据解析说明
```

---

## 数据同步服务器

Node.js HTTP 服务器，接收小程序采集的健康数据，双写至 JSON 文件和 MySQL 数据库，同时提供 REST API 供后端团队查询。

### MySQL 数据库配置

| 配置项 | 值 |
|-------|---|
| 数据库名 | `smart_followup_research` |
| 用户名 | `root` |
| 密码 | `health123` |
| 连接方式 | Unix Socket (`/var/run/mysqld/mysqld.sock`) |
| 字符集 | `utf8mb4` |

### 数据类型到 MySQL 表映射

| 小程序 dataType | MySQL 表 | 写入方式 |
|----------------|---------|---------|
| `heartRate` | `vital_heart_rate` | 直接 INSERT（独立列） |
| `bloodOxygen` | `vital_blood_oxygen` | 直接 INSERT（独立列） |
| `bloodPressure` | `vital_blood_pressure` | 直接 INSERT（独立列 + 风险等级自动分类） |
| `temperature` | `vital_signs` | JSON 写入（`data_type='temperature'`） |
| `bloodGlucose` | `vital_signs` | JSON 写入（`data_type='blood_glucose'`） |
| `sleep` | `vital_signs` | JSON 写入（`data_type='sleep'`） |
| `step` | `vital_signs` | JSON 写入（`data_type='step'`） |
| `ecg` | `vital_signs` | JSON 写入（`data_type='ecg'`） |
| `bloodLiquid` | `vital_signs` | JSON 写入（`data_type='blood_component'`） |
| `bodyComposition` | `vital_signs` | JSON 写入（`data_type='body_composition'`） |
| `daily` | `vital_signs` | JSON 写入（`data_type='daily'`） |

每次写入自动记录一条 `data_sync_logs`，包含 FHIR 校验状态。

---

## REST API 文档

服务器基地址：`http://localhost:3000`

所有响应均为 JSON 格式，`Content-Type: application/json; charset=utf-8`。

### 数据写入

#### POST /api/health-data

小程序端调用，保存采集的健康数据。

**请求体**：

```json
{
  "dataType": "heartRate",
  "data": { "heartRate": 72, "heartState": 0 },
  "date": "2026-03-15",
  "patientId": 1,
  "deviceId": 1
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `dataType` | string | 是 | 数据类型（11 种之一） |
| `data` | object | 是 | 体征数据（字段随类型不同） |
| `date` | string | 否 | 日期 YYYY-MM-DD，默认今天 |
| `patientId` | int | 否 | 患者 ID，默认 1 |
| `deviceId` | int | 否 | 设备 ID，默认 1 |

**响应**：

```json
{
  "success": true,
  "file": { "success": true, "filePath": "health_data/2026-03-15/heartRate.json", "recordCount": 5 },
  "mysql": { "insertId": 1682, "table": "vital_heart_rate" }
}
```

**示例**：

```bash
# 写入心率数据
curl -X POST http://localhost:3000/api/health-data \
  -H "Content-Type: application/json" \
  -d '{"dataType":"heartRate","data":{"heartRate":72,"heartState":0}}'

# 写入血压数据
curl -X POST http://localhost:3000/api/health-data \
  -H "Content-Type: application/json" \
  -d '{"dataType":"bloodPressure","data":{"systolic":120,"diastolic":80,"heartRate":72}}'

# 写入体温数据
curl -X POST http://localhost:3000/api/health-data \
  -H "Content-Type: application/json" \
  -d '{"dataType":"temperature","data":{"temperature":36.5}}'
```

### 数据查询

以下 GET 端点供后端团队按需拉取数据。

#### 通用查询参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `patient_id` | int | — | 按患者 ID 过滤 |
| `start` | datetime | — | 起始时间（如 `2026-03-01`） |
| `end` | datetime | — | 结束时间（如 `2026-03-15`） |
| `limit` | int | 100 | 返回记录数上限 |

#### GET /api/vitals/heart-rate

查询心率数据，返回 `vital_heart_rate` 表记录。

```bash
# 查询患者 1 的最近 10 条心率
curl "http://localhost:3000/api/vitals/heart-rate?patient_id=1&limit=10"

# 查询时间范围
curl "http://localhost:3000/api/vitals/heart-rate?start=2026-03-10&end=2026-03-15"
```

**响应示例**：

```json
{
  "data": [
    {
      "id": 1680,
      "patient_id": 1,
      "device_id": 1,
      "heart_rate": 72,
      "heart_state": "resting",
      "recorded_at": "2026-03-14T08:30:00.000Z",
      "patient_name": "张三"
    }
  ]
}
```

#### GET /api/vitals/blood-oxygen

查询血氧数据，返回 `vital_blood_oxygen` 表记录。参数同上。

```bash
curl "http://localhost:3000/api/vitals/blood-oxygen?patient_id=1&limit=5"
```

#### GET /api/vitals/blood-pressure

查询血压数据，返回 `vital_blood_pressure` 表记录。包含自动分类的 `risk_level`（normal/elevated/hypertension_1/hypertension_2/crisis）。

```bash
curl "http://localhost:3000/api/vitals/blood-pressure?patient_id=1"
```

**响应示例**：

```json
{
  "data": [
    {
      "id": 210,
      "patient_id": 1,
      "systolic": 135,
      "diastolic": 85,
      "pulse_rate": 76,
      "risk_level": "hypertension_1",
      "recorded_at": "2026-03-14T12:00:00.000Z",
      "patient_name": "张三"
    }
  ]
}
```

#### GET /api/vitals/signs

查询综合体征数据（体温、血糖、睡眠、步数、ECG、血液成分、身体成分、日常），返回 `vital_signs` 表记录。

| 额外参数 | 说明 |
|---------|------|
| `data_type` | 按类型过滤：`temperature`、`blood_glucose`、`sleep`、`step`、`ecg`、`blood_component`、`body_composition`、`daily` |

```bash
# 查询所有体温数据
curl "http://localhost:3000/api/vitals/signs?data_type=temperature&patient_id=1"

# 查询所有睡眠数据
curl "http://localhost:3000/api/vitals/signs?data_type=sleep&limit=7"
```

**响应示例**：

```json
{
  "data": [
    {
      "id": 445,
      "patient_id": 1,
      "data_type": "temperature",
      "vital_data": "{\"temperature\":36.5}",
      "fhir_resource_type": "Observation",
      "recorded_at": "2026-03-14T14:00:00.000Z",
      "patient_name": "张三"
    }
  ]
}
```

> 注意：`vital_data` 字段为 JSON 字符串，需要客户端自行 `JSON.parse()` 解析。

#### GET /api/vitals/reports

查询结构化分析报告，返回 `structured_reports` 表记录。

| 额外参数 | 说明 |
|---------|------|
| `report_type` | 报告类型：`daily`、`weekly`、`monthly`、`alert` |

```bash
curl "http://localhost:3000/api/vitals/reports?patient_id=1&report_type=daily"
```

#### GET /api/vitals/summary

查询所有表的数据总量统计，无需参数。

```bash
curl "http://localhost:3000/api/vitals/summary"
```

**响应示例**：

```json
{
  "data": [
    {
      "heart_rate_count": 1681,
      "blood_oxygen_count": 841,
      "blood_pressure_count": 211,
      "vital_signs_count": 453,
      "sync_logs_count": 141,
      "reports_count": 80,
      "patients_count": 5,
      "devices_count": 8
    }
  ]
}
```

#### GET /api/patients

查询受试者列表，包含队列名称。

```bash
curl "http://localhost:3000/api/patients"
```

#### GET /api/devices

查询设备列表，包含绑定的患者名称。

```bash
curl "http://localhost:3000/api/devices"
```

### 管理接口

#### GET /api/health-data

查询文件级数据。传 `date` 参数返回指定日期，不传返回全部。

```bash
# 查询 2026-03-14 的所有数据文件
curl "http://localhost:3000/api/health-data?date=2026-03-14"

# 查询全部日期数据
curl "http://localhost:3000/api/health-data"
```

#### DELETE /api/health-data

清除所有 JSON 文件数据（不影响 MySQL）。

```bash
curl -X DELETE "http://localhost:3000/api/health-data"
```

#### GET /api/status

查询服务器运行状态。

```bash
curl "http://localhost:3000/api/status"
# {"status":"running","timestamp":"...","mysqlEnabled":true,"dataDir":"..."}
```

---

## 数据库设计

### 9 张业务表

| 表名 | 用途 | 关键列 | 演示数据量 |
|------|------|--------|-----------|
| `research_cohorts` | 研究队列定义 | `cohort_name`, `status`, `target_size` | 2 |
| `patients` | 受试者信息 | `patient_no`, `name`, `diagnosis`, `status` | 5 |
| `medical_devices` | 二类医疗器械设备 | `registration_cert_no`, `model`, `mac_address` | 8 |
| `vital_heart_rate` | 心率数据 | `heart_rate`, `heart_state`, `recorded_at` | 1,680 |
| `vital_blood_oxygen` | 血氧数据 | `spo2`, `recorded_at` | 840 |
| `vital_blood_pressure` | 血压数据 | `systolic`, `diastolic`, `risk_level` | 210 |
| `vital_signs` | 综合体征 JSON | `data_type`, `vital_data`(JSON), `fhir_resource_type` | 445 |
| `data_sync_logs` | 同步审计日志 | `sync_channel`, `fhir_validated`, `status` | 140 |
| `structured_reports` | 结构化报告 | `report_type`, `data_summary`(JSON), `risk_flags` | 80 |

### 数据库初始化

```bash
# 完整初始化（建库建表 + 3,395 条演示数据：14 天 × 5 名受试者）
mysql -u root -phealth123 < database/init.sql

# 仅建表（不含数据）
mysql -u root -phealth123 < database/schema.sql
```

### 常用查询

```sql
-- 研究队列总览
SELECT c.cohort_name, COUNT(DISTINCT p.id) AS 受试者数, COUNT(DISTINCT d.id) AS 设备数
FROM research_cohorts c
JOIN patients p ON p.cohort_id = c.id
JOIN medical_devices d ON d.patient_id = p.id
GROUP BY c.id;

-- 患者 7 天心率趋势
SELECT DATE(recorded_at) AS 日期, ROUND(AVG(heart_rate),1) AS 平均心率,
       MIN(heart_rate) AS 最低, MAX(heart_rate) AS 最高
FROM vital_heart_rate WHERE patient_id = 1
GROUP BY DATE(recorded_at) ORDER BY 日期 DESC LIMIT 7;

-- 数据库总量统计
SELECT
  (SELECT COUNT(*) FROM vital_heart_rate) +
  (SELECT COUNT(*) FROM vital_blood_oxygen) +
  (SELECT COUNT(*) FROM vital_blood_pressure) +
  (SELECT COUNT(*) FROM vital_signs) AS 体征记录总数;

-- 按数据类型统计 vital_signs 记录
SELECT data_type, COUNT(*) AS 记录数 FROM vital_signs GROUP BY data_type;
```

---

## BLE 连接与数据采集

### 设备连接流程

```typescript
import { veepooBle, veepooFeature } from '../../libs/vp_sdk/index';

// 1. 扫描设备
veepooBle.veepooWeiXinSDKStartScanDeviceAndReceiveScanningDevice((device) => {
  console.log('发现设备:', device.name, device.mac);
});

// 2. 连接设备
veepooBle.veepooWeiXinSDKBleConnectionServicesCharacteristicsNotifyManager(
  { deviceId: 'XX:XX:XX:XX:XX:XX' },
  (result) => {
    if (result.success) {
      // 3. 密钥认证（必须在数据采集前完成）
      veepooFeature.veepooBlePasswordCheckManager();
    }
  }
);
```

### 数据采集与自动存储

采集的数据通过 `dataStorage` 服务保存，会自动同步到服务器。

```typescript
import { dataStorage } from '../../services/dataStorage';

// 保存心率数据（自动 POST 到服务器）
await dataStorage.saveHeartRateData({ heartRate: 72, heartState: 0 });

// 保存血氧数据
await dataStorage.saveBloodOxygenData({ bloodOxygen: 98 });

// 保存血压数据
await dataStorage.saveBloodPressureData({ systolic: 120, diastolic: 80 });

// 保存体温数据
await dataStorage.saveTemperatureData({ temperature: 36.5 });

// 保存 ECG 数据
await dataStorage.saveECGData({ heartRate: 72, ecgWaveform: [/*...*/] });

// 保存血糖数据
await dataStorage.saveBloodGlucoseData({ bloodGlucose: 5.6, mealState: 'fasting' });

// 保存血液成分
await dataStorage.saveBloodLiquidData({ uricAcid: 350, cholesterol: 4.5 });

// 保存身体成分
await dataStorage.saveBodyCompositionData({ weight: 70, bmi: 22.5, bodyFat: 18 });

// 保存步数
await dataStorage.saveStepData({ step: 8500, calorie: 320, distance: 6200 });

// 保存睡眠
await dataStorage.saveSleepData({ deepSleepMinutes: 120, lightSleepMinutes: 180 });

// 保存日常综合
await dataStorage.saveDailyData({ step: 8500, heartRate: 72, bloodOxygen: 98 });
```

### 完整 SDK API 文档

详细 API 文档（5,600+ 行）位于 `docs/VeepooWeiXinSDK使用文档.md`。

---

## 本地数据存储

小程序采集的数据先写入本地文件系统，再异步同步到服务器。

### 存储目录结构

```
health_data/
├── 2026-03-14/
│   ├── heartRate.json       # 心率
│   ├── bloodOxygen.json     # 血氧
│   ├── bloodPressure.json   # 血压
│   ├── temperature.json     # 体温
│   ├── ecg.json             # ECG
│   ├── bloodGlucose.json    # 血糖
│   ├── bloodLiquid.json     # 血液成分
│   ├── bodyComposition.json # 身体成分
│   ├── step.json            # 步数
│   ├── sleep.json           # 睡眠
│   └── daily.json           # 日常综合
└── 2026-03-15/
    └── ...
```

### 文件格式

每个 JSON 文件结构：

```json
{
  "date": "2026-03-14",
  "lastUpdated": "2026-03-14T14:30:00.000Z",
  "records": [
    {
      "timestamp": "2026-03-14T08:00:00.000Z",
      "heartRate": 68,
      "heartState": 0
    },
    {
      "timestamp": "2026-03-14T12:00:00.000Z",
      "heartRate": 75,
      "heartState": 1
    }
  ]
}
```

---

## 数据导出

`dataExport` 服务提供数据导出和分享功能。

```typescript
import { dataExport } from '../../services/dataExport';

// 导出所有数据为 JSON 文件
const filePath = await dataExport.exportAllData();

// 导出指定日期范围
const filePath = await dataExport.exportDataByDateRange('2026-03-01', '2026-03-15');

// 导出指定类型
const filePath = await dataExport.exportDataByType('heartRate');

// 导出今日数据
const filePath = await dataExport.exportTodayData();

// 微信分享导出文件
await dataExport.shareViaWeChat(filePath);

// 查看数据统计
const stats = dataExport.getDataStatistics();
// { totalDays: 14, dataTypes: ['heartRate', ...], totalRecords: 3395, dateRange: {...} }
```

---

## 故障排除

### MySQL 连接失败

**症状**：服务器启动时显示 `mysql2 未安装` 或连接超时

```bash
# 1. 安装 mysql2
cd scripts && npm install mysql2

# 2. 启动 MySQL 服务
echo "xyf" | sudo -S service mysql start

# 3. 验证连接
mysql -u root -phealth123 -e "SELECT 1"
```

**auth_socket 认证问题**：如果 TCP 连接失败（`Access denied`），服务器已配置使用 Unix Socket 连接（`socketPath: '/var/run/mysqld/mysqld.sock'`），无需修改。

### 服务器端口被占用

```bash
# 查找占用 3000 端口的进程
lsof -ti:3000

# 终止进程
lsof -ti:3000 | xargs kill
```

### BLE 连接问题

- **模拟器中扫描不到设备**：正常现象，BLE 必须使用真机测试
- **扫描不到设备**：确保设备已开机且在蓝牙范围内，手机已开启蓝牙和定位权限
- **连接失败**：检查设备是否已被其他手机连接，尝试重启设备和手机蓝牙
- **功能 API 报错**：确保已完成密钥认证（`veepooFeature.veepooBlePasswordCheckManager()`）

### 端口说明

项目中存在两个端口配置：
- **`dataStorage.ts`（端口 3000）**：主数据同步服务，每次采集数据后自动 POST 到此端口。**这是实际使用的服务**。
- **`httpSync.ts`（端口 3456）**：遗留代码，尚未更新端口。实际数据同步通过 `dataStorage.ts` 完成，此文件可忽略。

### 小程序编译问题

- **域名校验错误**：开发者工具必须勾选"不校验合法域名"
- **编译报错**：确保基础库 ≥ 3.8.9，已启用 TypeScript 和 LESS 编译插件
- **增强编译**：建议勾选"增强编译"以获得更好的 ES6+ 支持

---

## 运行环境兼容性

| 平台 | 支持状态 | 备注 |
|------|---------|------|
| Android | ✅ 完全支持 | Android 5.0+ |
| iOS | ✅ 完全支持 | iOS 10+ |
| HarmonyOS 4.0 | ✅ 支持 | 兼容 Android BLE API |
| HarmonyOS Next | ⚠️ 部分支持 | 部分功能需适配 |

---

## SDK 版本历史

| 版本 | 日期 | 编辑 | 更新内容 |
|------|------|------|---------|
| V1.1.16 | 2026/01/09 | 陈显文 | 新增配置 4G 服务信息接口 |
| V1.1.15 | 2026/01/04 | 陈显文 | 修复已知问题 |
| V1.1.14 | 2025/12/29 | 陈显文 | 新增 ZT163 常灭屏功能接口 |
| V1.1.13 | 2025/12/16 | 陈显文 | 新增 JH58 动态血压监测、血液成分接口更新 |
| V1.1.12 | 2025/12/05 | 陈显文 | 血糖风险等级解析优化 |
| V1.1.11 | 2025/11/19 | 陈显文 | ECG 波形兼容性增强 |
| V1.1.9 | 2025/10/22 | 陈显文 | BLE 扫描修复 |
| V1.1.8 | 2025/07/10 | 陈显文 | 新增多个数据采集接口 |
| V1.1.7 | 2025/03/22 | 陈显文 | 初始稳定版本 |

---

## 注意事项

1. **蓝牙测试需真机**：模拟器不支持 BLE 通信，所有设备功能必须在真机上测试
2. **密钥认证**：连接设备后必须完成密钥认证才能调用数据采集 API
3. **框架限制**：仅支持微信原生 + TypeScript 开发，**不兼容** mpvue、uni-app、Taro 等框架
4. **数据合规**：采集的体征数据涉及个人健康信息，使用时需遵守相关隐私保护法规
5. **OTA 与表盘**：固件升级和表盘传输功能仅支持杰理芯片设备

---

## 许可证

详见 [LICENSE](./LICENSE)
