# 智能随访系统 — 可穿戴设备体征数据采集平台

基于 Veepoo BLE SDK 的微信小程序医疗级智能穿戴设备数据采集平台。**系统已部署生产环境**，数据通过 `https://dc.ncrc.org.cn/api2` 写入六元空间 MySQL 数据库。

当前已集成 **2 款具备二类医疗器械注册证资质**的 Veepoo 可穿戴设备，支持 **11 类体征数据**的自动采集，采集端尽可能多存，客户按需拉取。

---

## 目录

- [生产环境架构](#生产环境架构)
- [支持的设备](#支持的设备)
- [数据采集能力（11 类体征数据）](#数据采集能力11-类体征数据)
- [REST API 文档](#rest-api-文档)
- [数据库设计](#数据库设计)
- [快速验证（生产环境）](#快速验证生产环境)
- [本地开发环境](#本地开发环境)
- [BLE 连接与数据采集](#ble-连接与数据采集)
- [小程序本地存储](#小程序本地存储)
- [数据导出](#数据导出)
- [故障排除](#故障排除)
- [项目结构](#项目结构)
- [SDK 版本历史](#sdk-版本历史)
- [注意事项](#注意事项)

---

## 生产环境架构

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────────┐
│   可穿戴设备      │────→│  微信小程序        │────→│  六元外网代理             │
│                 │ BLE │                  │HTTPS│  dc.ncrc.org.cn/api2    │
│ AMOLED 手表     │     │ Veepoo SDK(378KB)│POST │                         │
│ R04 智能戒指    │     │ 11 类数据采集     │     │                         │
└─────────────────┘     └──────────────────┘     └────────────┬────────────┘
                                                              │ 反向代理
                                                 ┌────────────▼────────────┐
                                                 │  公司服务器               │
                                                 │  192.168.4.104          │
                                                 │  Python HTTP 服务        │
                                                 └────────────┬────────────┘
                                                              │ SQL INSERT
                                                 ┌────────────▼────────────┐
                                                 │  六元 MySQL              │
                                                 │  192.168.4.222          │
                                                 │  数据库: h6dp_suifang    │
                                                 │  ├ wearable_device (设备)│
                                                 │  └ wearable_device_data  │
                                                 │    (体征数据, JSON 格式) │
                                                 └─────────────────────────┘
```

**数据流说明**：
1. **设备层**：AMOLED 手表或 R04 戒指通过 BLE 蓝牙发送原始数据帧
2. **采集层**：微信小程序中的 Veepoo SDK 解析协议帧为结构化数据，存入本地 JSON 缓存
3. **上传层**：小程序自动 HTTP POST 到 `https://dc.ncrc.org.cn/api2/api/health-data`
4. **代理层**：六元空间技术负责人配置的外网反向代理，转发到内网服务器
5. **服务层**：公司服务器上的 Python HTTP 服务接收数据，转为中文 JSON 格式
6. **存储层**：INSERT 到六元 MySQL 的 `wearable_device_data` 表

---

## 支持的设备

| 设备 | 型号 | 佩戴方式 | 生产厂商 | 注册证编号 | 采集指标 | 连接方式 | 状态 |
|------|------|---------|---------|-----------|---------|---------|------|
| R04 蓝牙智能戒指 | VPR04-BLE | 指戴式 | 深圳维亿魄科技 | 粤械注准20232070845 | 心率、血氧、HRV、压力、睡眠 | BLE 4.2+ | ✅ 已集成 |
| AMOLED 智能手表 | VP-W680 | 腕戴式 | 深圳维亿魄科技 | 粤械注准20242211536 | 血压、体温、血糖、血液成分、身体成分、血氧 | BLE 5.0 | ✅ 已集成 |

两款设备共享同一个 BLE SDK（`vp_sdk`，378KB JS），该 SDK 是**设备无关的通用协议层**——连接任何 Veepoo BLE 设备后，通过功能汇总包自动识别该设备支持的数据类型，无需针对不同设备型号修改代码。

---

## 数据采集能力（11 类体征数据）

| 序号 | 数据类型 | 英文标识 | 关键字段 | 单位 | 上传 JSON 格式示例 |
|------|---------|---------|---------|------|-------------------|
| 1 | 心率 | heartRate | heartRate, heartState | bpm | `{"类型":"心率","心率值":72,"心率状态":"静息"}` |
| 2 | 血氧 | bloodOxygen | bloodOxygen | % | `{"类型":"血氧","血氧饱和度":98,"心率":70}` |
| 3 | 血压 | bloodPressure | systolic, diastolic | mmHg | `{"类型":"血压","高压":128,"低压":82,"脉搏":72,"风险等级":"正常"}` |
| 4 | 体温 | temperature | temperature, skinTemperature | °C | `{"类型":"体温","体温":36.5,"皮肤温度":33.2}` |
| 5 | ECG | ecg | heartRate, ecgWaveform[] | mV | `{"类型":"心电","心率":73,"诊断":"窦性心律"}` |
| 6 | 血糖 | bloodGlucose | bloodGlucose, mealState | mmol/L | `{"类型":"血糖","血糖值_mmol_L":5.8,"餐态":"餐后2小时"}` |
| 7 | 血液成分 | bloodLiquid | uricAcid, cholesterol | mg/dL | `{"类型":"血液成分","尿酸":350,"胆固醇":4.5}` |
| 8 | 身体成分 | bodyComposition | weight, bmi, bodyFat | kg/% | `{"类型":"身体成分","体重":68.5,"BMI":22.3}` |
| 9 | 步数 | step | step, calorie, distance | 步/cal/m | `{"类型":"步数","步数":8523,"卡路里":320}` |
| 10 | 睡眠 | sleep | deepSleepTime, lightSleepTime | 分钟 | `{"类型":"睡眠","深睡_分钟":120,"浅睡_分钟":280}` |
| 11 | 日综合 | daily | 各项日汇总 | 混合 | `{"类型":"daily",...}` |

所有类型在 `miniprogram/types/healthData.ts` 中有严格的 TypeScript 接口定义。

---

## REST API 文档

**生产基地址**：`https://dc.ncrc.org.cn/api2`

### 数据写入

#### POST /api/health-data

小程序端自动调用，写入一条体征记录到六元 MySQL。

**请求体**：

```json
{
  "dataType": "bloodPressure",
  "data": { "systolic": 128, "diastolic": 82, "heartRate": 72 },
  "deviceId": 1
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `dataType` | string | 是 | 数据类型（11 种之一） |
| `data` | object | 是 | 体征数据 |
| `deviceId` | int | 否 | 设备 ID（关联 wearable_device 表），默认 1 |

**示例**：

```bash
# 写入血压数据
curl -X POST https://dc.ncrc.org.cn/api2/api/health-data \
  -H "Content-Type: application/json" \
  -d '{"dataType":"bloodPressure","data":{"systolic":120,"diastolic":80,"heartRate":72}}'

# 写入心率数据
curl -X POST https://dc.ncrc.org.cn/api2/api/health-data \
  -H "Content-Type: application/json" \
  -d '{"dataType":"heartRate","data":{"heartRate":72,"heartState":0}}'

# 写入体温数据
curl -X POST https://dc.ncrc.org.cn/api2/api/health-data \
  -H "Content-Type: application/json" \
  -d '{"dataType":"temperature","data":{"temperature":36.5}}'
```

### 数据查询

#### GET /api/data

查询所有已写入的体征数据。

```bash
curl https://dc.ncrc.org.cn/api2/api/data
```

#### GET /api/status

查询服务器运行状态和六元 MySQL 连接状态。

```bash
curl https://dc.ncrc.org.cn/api2/api/status
```

---

## 数据库设计

### 生产数据库（六元 MySQL）

六元空间部署的 MySQL 数据库，服务器地址 `192.168.4.222`，数据库名 `h6dp_suifang`。

**wearable_device（设备表，六元维护）**

| 列名 | 类型 | 说明 |
|------|------|------|
| id | int | 主键，设备 ID |
| device_sign | varchar | 设备标识 |
| type | int | 设备类型 |

**wearable_device_data（数据表，我们写入）**

| 列名 | 类型 | 说明 |
|------|------|------|
| id | int | 自增主键 |
| deviceId | int | 关联 wearable_device.id（**唯一**，一台设备一行） |
| data | text | 大 JSON：按 11 类数据分组，每类是历史测量数组 |
| createTime | datetime | 最后更新时间 |

**写入逻辑**：UPSERT 模式 — 每台设备在表中只占 **1 行**。新数据进来时：
1. SELECT 现有行 → 解析 `data` 列大 JSON
2. 把新测量 push 到对应类型数组（如 `心率` 数组）
3. UPDATE 写回（首次写入则 INSERT 新行）

**data 列大 JSON 格式示例**（一行包含全部 11 类数据）：

```json
{
  "心率": [
    {"心率值": 72, "心率状态": "静息", "采集时间": "2026-03-24T07:38:45.000Z"},
    {"心率值": 75, "心率状态": "静息", "采集时间": "2026-03-24T08:08:45.000Z"}
  ],
  "血压": [
    {"高压": 128, "低压": 82, "脉搏": 72, "风险等级": "正常", "采集时间": "2026-03-24T07:40:00.000Z"}
  ],
  "血氧": [
    {"血氧饱和度": 98, "心率": 70, "采集时间": "2026-03-24T08:00:00.000Z"}
  ],
  "体温": [
    {"体温": 36.5, "皮肤温度": 33.2, "采集时间": "2026-03-24T08:30:00.000Z"}
  ],
  "血糖": [
    {"血糖值_mmol_L": 5.8, "餐态": "餐后2小时", "采集时间": "2026-03-24T13:30:00.000Z"}
  ],
  "血液成分": [
    {"尿酸": 350, "胆固醇": 4.5, "甘油三酯": 1.2, "采集时间": "2026-03-24T09:00:00.000Z"}
  ],
  "身体成分": [
    {"体重": 68.5, "BMI": 22.3, "体脂率": 18.2, "肌肉量": 52.1, "采集时间": "2026-03-24T07:00:00.000Z"}
  ],
  "心电": [
    {"心率": 73, "诊断": "窦性心律", "波形采样点数": 512, "采集时间": "2026-03-24T10:00:00.000Z"}
  ],
  "步数": [
    {"步数": 8523, "卡路里": 320, "距离_米": 5800, "采集时间": "2026-03-24T20:00:00.000Z"}
  ],
  "睡眠": [
    {"入睡时间": "23:15", "醒来时间": "07:30", "深睡_分钟": 120, "浅睡_分钟": 280, "采集时间": "2026-03-24T07:30:00.000Z"}
  ]
}
```

11 类数据 → 11 个键，每个键的值都是历史测量数组。客户读取时只需查询一次，按需取对应类型字段即可。

### 开发数据库（仅本地调试用）

本地 WSL 环境有一个 MySQL 开发数据库 `smart_followup_research`，9 张表，3,395 条演示数据。详见 `database/schema.sql`。

```bash
# 本地开发数据库初始化
echo "xyf" | sudo -S service mysql start
mysql -u root -phealth123 < database/init.sql
```

---

## 快速验证（生产环境）

生产环境已部署，无需本地搭建即可验证：

```bash
# 1. 检查服务器状态
curl https://dc.ncrc.org.cn/api2/api/status

# 2. 查看已有数据
curl https://dc.ncrc.org.cn/api2/api/data

# 3. 写入一条测试数据
curl -X POST https://dc.ncrc.org.cn/api2/api/health-data \
  -H "Content-Type: application/json" \
  -d '{"dataType":"heartRate","data":{"heartRate":75,"heartState":0}}'

# 4. 再次查询确认数据已写入
curl https://dc.ncrc.org.cn/api2/api/data
```

---

## 本地开发环境

本地开发环境用于代码修改和调试，不影响生产数据。

### 环境要求

| 工具 | 版本 | 用途 |
|------|------|------|
| 微信开发者工具 | 最新稳定版 | 小程序编译调试 |
| Node.js | ≥ 16.x | 本地数据同步服务（可选） |
| MySQL | 8.0+ | 本地开发数据库（可选） |
| 支持 BLE 的手机 | Android 5.0+ / iOS 10+ | 真机测试 |

### 环境搭建

```bash
# 1. 克隆项目
git clone https://github.com/qqyjx/suifang.git
cd WeChat_Mini_Program_Ble_SDK

# 2. 在微信开发者工具中导入项目
#    路径：code/demo/WeiXinSDKTSDemo
#    AppID：wxbc5453a4c53dbee8
#    勾选"不校验合法域名" + "增强编译"
#    基础库 ≥ 3.8.9
```

### WSL 开发工作流

项目运行在 WSL 中，配合 Windows 版微信开发者工具：

```
WSL VSCode 编辑代码 → 保存 → Windows 微信开发者工具自动热重载 → 查看效果/真机调试
```

微信开发者工具导入路径：
```
\\wsl$\Ubuntu\home\qq\WeChat_Mini_Program_Ble_SDK\code\demo\WeiXinSDKTSDemo
```

### 生产 vs 开发环境切换

`dataStorage.ts` 中的服务器地址控制数据流向：

```typescript
// 当前配置（生产环境）
const WSL_SERVER_URL = 'https://dc.ncrc.org.cn/api2';

// 切换为本地开发（需启动本地 Node.js 服务器）
// const WSL_SERVER_URL = 'http://127.0.0.1:3000';
```

本地 Node.js 开发服务器启动：
```bash
echo "xyf" | sudo -S service mysql start
cd scripts && npm install && node health-data-server.js
# 访问 http://localhost:3000/api/status 验证
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

### 数据采集与自动上传

采集的数据通过 `dataStorage` 服务自动保存到本地并上传到生产服务器。

```typescript
import { dataStorage } from '../../services/dataStorage';

// 保存心率（自动 POST 到 dc.ncrc.org.cn/api2）
await dataStorage.saveHeartRateData({ heartRate: 72, heartState: 0 });

// 保存血压
await dataStorage.saveBloodPressureData({ systolic: 120, diastolic: 80 });

// 保存血氧
await dataStorage.saveBloodOxygenData({ bloodOxygen: 98 });

// 保存体温
await dataStorage.saveTemperatureData({ temperature: 36.5 });

// 保存步数
await dataStorage.saveStepData({ step: 8500, calorie: 320, distance: 6200 });

// 保存睡眠
await dataStorage.saveSleepData({ deepSleepMinutes: 120, lightSleepMinutes: 180 });
```

完整 SDK API 文档（5,600+ 行）：`docs/VeepooWeiXinSDK使用文档.md`

---

## 小程序本地存储

小程序采集的数据先写入手机本地文件系统，再异步上传到服务器。断网时数据不丢失。

```
{wx.env.USER_DATA_PATH}/health_data/
├── 2026-03-24/
│   ├── heartRate.json
│   ├── bloodOxygen.json
│   ├── bloodPressure.json
│   ├── temperature.json
│   └── ...
└── 2026-03-25/
    └── ...
```

每个 JSON 文件包含当日该类型的所有采集记录。

---

## 数据导出

```typescript
import { dataExport } from '../../services/dataExport';

// 导出所有数据
const filePath = await dataExport.exportAllData();

// 导出指定日期范围
const filePath = await dataExport.exportDataByDateRange('2026-03-01', '2026-03-15');

// 微信分享
await dataExport.shareViaWeChat(filePath);

// 查看数据统计
const stats = dataExport.getDataStatistics();
```

---

## 故障排除

### BLE 连接问题

- **模拟器中扫描不到设备**：正常现象，BLE 必须使用真机测试
- **扫描不到设备**：确保设备已开机，手机已开启蓝牙和定位权限
- **连接后无法采集**：必须先完成密钥认证 `veepooFeature.veepooBlePasswordCheckManager()`

### 数据上传失败

- **网络错误**：检查手机网络是否正常，生产地址 `dc.ncrc.org.cn` 是否可达
- **服务器无响应**：`curl https://dc.ncrc.org.cn/api2/api/status` 检查服务状态
- **数据已缓存**：即使上传失败，数据仍保存在小程序本地存储中，不会丢失

### 小程序编译问题

- **域名校验错误**：开发者工具必须勾选"不校验合法域名"
- **编译报错**：确保基础库 ≥ 3.8.9，已启用 TypeScript 和 LESS 编译插件

---

## 项目结构

```
WeChat_Mini_Program_Ble_SDK/
├── README.md                          # 本文件
├── 智能随访说明.md                     # 完整系统需求说明
├── SDK功能清单.md                      # SDK 全部功能清单
├── 开发环境使用指南.md                  # WSL + 微信开发者工具配置
│
├── code/demo/WeiXinSDKTSDemo/         # 微信小程序主项目
│   └── miniprogram/
│       ├── pages/                     # 57 个功能页面
│       ├── services/
│       │   ├── dataStorage.ts         # 数据存储 + HTTP 上传（→ dc.ncrc.org.cn）
│       │   ├── dataExport.ts          # 数据导出（JSON + 微信分享）
│       │   └── httpSync.ts            # 遗留代码，不使用
│       └── types/
│           └── healthData.ts          # 11 种体征数据 TypeScript 接口定义
│
├── libs/
│   ├── vp_sdk/                        # Veepoo BLE SDK（378KB JS，设备无关协议层）
│   └── jieli_sdk/                     # 杰理 BLE SDK（OTA/表盘传输）
│
├── scripts/
│   ├── health-data-server.js          # 公司服务器上运行的数据服务（含六元 MySQL 对接）
│   └── package.json                   # Node.js 依赖
│
├── database/
│   ├── schema.sql                     # 本地开发数据库表结构
│   └── init.sql                       # 本地开发数据库（含演示数据）
│
└── docs/
    ├── SDK数据采集全景.md              # 数据流水线详细文档
    └── VeepooWeiXinSDK使用文档.md     # SDK 完整 API 文档（5,600+ 行）
```

---

## SDK 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|---------|
| V1.1.16 | 2026/01/09 | 新增配置 4G 服务信息接口 |
| V1.1.15 | 2026/01/04 | 修复已知问题 |
| V1.1.14 | 2025/12/29 | 新增 ZT163 常灭屏功能接口 |
| V1.1.13 | 2025/12/16 | 新增 JH58 动态血压监测 |
| V1.1.12 | 2025/12/05 | 血糖风险等级解析优化 |
| V1.1.11 | 2025/11/19 | ECG 波形兼容性增强 |

---

## 运行环境兼容性

| 平台 | 支持状态 | 备注 |
|------|---------|------|
| Android | ✅ 完全支持 | Android 5.0+ |
| iOS | ✅ 完全支持 | iOS 10+ |
| HarmonyOS 4.0 | ✅ 支持 | 兼容 Android BLE API |
| HarmonyOS Next | ⚠️ 部分支持 | 部分功能需适配 |

---

## 注意事项

1. **蓝牙测试需真机**：模拟器不支持 BLE 通信
2. **密钥认证**：连接设备后必须完成密钥认证才能采集数据
3. **框架限制**：仅支持微信原生 + TypeScript，不兼容 uni-app/Taro
4. **数据合规**：采集的体征数据涉及个人健康信息，需遵守隐私保护法规
5. **OTA 与表盘**：固件升级和表盘传输仅支持杰理芯片设备

---

## 当前状态

| 维度 | 状态 |
|------|------|
| 生产数据服务 | ✅ 已部署（dc.ncrc.org.cn/api2 → 六元 MySQL） |
| 数据管道代码 | ✅ 全链路打通（BLE → 小程序 → HTTPS → MySQL） |
| demo 数据验证 | ✅ 17 条样例数据已写入生产库 |
| 真机 BLE 测试 | ❌ 待测试（需用手表采集真实数据） |
