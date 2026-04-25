# 真机测试 Checklist — 打通硬件数据流

本文档指导从零开始用 AMOLED 手表 + 手机微信小程序，验证数据从 BLE 硬件端到端流入六元 MySQL 的完整链路。

---

## 数据流概览

```
AMOLED 手表 ──BLE──→ 手机微信小程序 ──HTTPS──→ dc.ncrc.org.cn/api2 ──→ 六元 MySQL (deviceId=4)
   待测               待测                     已验证                已验证
```

**真机测试数据写入 `deviceId=4`**，demo 数据（deviceId=1/2/3）保留完整。

---

## 准备工作

### 环境就绪检查

| 项 | 检查命令 | 期望 |
|----|---------|------|
| 六元 API 可达 | `curl -s https://dc.ncrc.org.cn/api2/api/status` | `"status":"running"` |
| register API 已上线 | `curl -s https://dc.ncrc.org.cn/api2/ \| python3 -m json.tool \| grep device/register` | 命中 `POST /api/device/register` |
| 3 台 demo 设备在 | `curl -s https://dc.ncrc.org.cn/api2/api/data \| python3 -c "import json,sys; print(json.load(sys.stdin)['count'])"` | `3` |
| S101 已注册 | `curl -s 'https://dc.ncrc.org.cn/api2/api/device/by-sign?sign=S101_FA:BA:94:8A:70:75'` | 含 `"id":4` |
| 手表已充电开机 | 看手表屏幕 | 显示时间 |
| 手表未被其他 App 连 | 从其他设备断开蓝牙 | — |

### 需要的东西

- 能上网的手机（Android 5.0+ 或 iOS 10+），手机微信已登录
- AMOLED 手表（VP-W680），已充电
- Windows 电脑 + 微信开发者工具（最新稳定版）

---

## Phase A：Windows 侧导入项目

- [ ] **A1.** 打开 Windows 版微信开发者工具
- [ ] **A2.** 点「导入项目」，目录填：
  ```
  \\wsl$\Ubuntu\home\qq\WeChat_Mini_Program_Ble_SDK\code\demo\WeiXinSDKTSDemo
  ```
- [ ] **A3.** AppID：`wxbc5453a4c53dbee8`
- [ ] **A4.** 点「设置 → 项目设置」：
  - [ ] 本地设置：勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」
  - [ ] 本地设置：勾选「增强编译」
  - [ ] 基础库：`≥ 3.8.9`
- [ ] **A5.** 点「编译」，看模拟器窗口是否出现小程序首页
- [ ] **A6.** 看控制台：**无红色报错**（黄色警告可忽略）

**验收：** 模拟器显示首页，控制台无红色错误。

---

## Phase B：真机预览

- [ ] **B1.** 在微信开发者工具点右上角「预览」按钮
- [ ] **B2.** 弹出二维码
- [ ] **B3.** 手机微信扫码 → 打开小程序
- [ ] **B4.** 手机上的权限检查：
  - [ ] 系统蓝牙：已开启
  - [ ] 系统定位：已开启（微信扫 BLE 需要定位权限）
  - [ ] 微信 → 设置 → 隐私 → 授权管理：蓝牙已授权
  - [ ] 微信 → 设置 → 隐私 → 授权管理：位置已授权

**验收：** 手机上能看到小程序首页，有功能菜单列表。

---

## Phase C：BLE 连接 + 密钥认证（关键卡点）

- [ ] **C1.** 手机小程序首页 → 找「蓝牙连接」或类似入口 → 进入 `pages/bleConnection`
- [ ] **C2.** 点「扫描」按钮
  - 期望：5 秒内列出附近的 BLE 设备
  - 手表应出现，名称类似 `VP-W680` 或 MAC 地址开头
- [ ] **C3.** 点选中手表
  - 期望：「连接中...」loading，5-10 秒后成功
  - 期望：密钥认证 `veepooBlePasswordCheckManager()` 成功
  - 期望：跳回首页，显示设备已连接
- [ ] **C4.** 在首页确认「已连接 VP-W680」或类似字样

**若卡在「连接中」：**

1. 在微信开发者工具点「远程调试」→「vConsole」查看日志
2. 看是否有 `veepooBlePasswordCheckManager` 的调用日志
3. 重启手表蓝牙（关机再开）
4. 确认没有其他手机或 App 正在连这只手表
5. 关闭小程序重新扫码打开

**验收：** 首页显示设备已连接，无持续 loading。

---

## Phase D：第一类数据验证 — 心率（最快）

**WSL 端准备：** 在 WSL 终端启动实时监控：
```bash
cd /home/qq/WeChat_Mini_Program_Ble_SDK
bash scripts/watch-production-data.sh
```
监控界面会实时显示 `deviceId=4` 的状态（初始应为「尚无数据」）。

---

- [ ] **D1.** 手机小程序首页 → 进入「心率测试」页面（`pages/heartRateTest`）
- [ ] **D2.** 点「开始测量」按钮
- [ ] **D3.** 戴上手表（确保贴紧手腕）
- [ ] **D4.** 等 5-15 秒
  - 期望：UI 显示真实心率值（如 `72 bpm`）
- [ ] **D5.** 在微信开发者工具 vConsole 查看日志：
  - 期望看到：`[DataStorage] HTTP同步heartRate成功: ...`
  - 期望看到：`action: "insert"` 或 `"update"`
- [ ] **D6.** 在 WSL 监控界面看：
  - 期望：`设备4` 从「尚无数据」变为 `心率(1): {心率值: XX, ...}`
  - 采集时间应该是现在的时间

**验收三条：**
- ✅ 手机 UI 看到真实心率
- ✅ vConsole 看到 HTTP 同步成功日志
- ✅ WSL 监控看到 deviceId=4 新增了心率记录

**达成这三条 = 第一个硬件数据类型打通成功。**

---

## Phase E：扩展测试其他数据类型

每种数据独立测试，失败一个不影响其他。每跑完一个在监控面板确认数据到达。

- [ ] **E1. 血氧** `pages/bloodOxygen`
  - 点测量 → 等 10 秒
  - 监控面板：`设备4` 新增 `血氧(1)`
- [ ] **E2. 血压** `pages/universalBlood`
  - 点开始 → 手表充气测量 → 等 30-60 秒
  - 监控面板：`设备4` 新增 `血压(1)`
- [ ] **E3. 体温** `pages/bodyTemperature`
  - 手表贴皮肤 → 点读取
  - 监控面板：`设备4` 新增 `体温(1)`
- [ ] **E4. 步数** `pages/readDailyData`
  - 点读取今日数据
  - 监控面板：`设备4` 新增 `步数(1)`
- [ ] **E5. 睡眠** `pages/sleep`（需要过夜数据，可选）
  - 点读取昨夜数据
  - 监控面板：`设备4` 新增 `睡眠(1)`

---

## Phase F：鲁棒性验证（4.27 体验版交付前必跑）

> 在 D/E 数据类型打通后做。任何一条不过都不应交付。

- [ ] **F1. 断网重传**
  - 测心率前手机切飞行模式
  - 在心率页测一组数据
  - vConsole 期望看到：`HTTP同步heartRate失败入队待补传`
  - 关闭飞行模式，等 5-10 秒
  - vConsole 期望看到：`[Sync] 网络恢复补传 {ok: 1, fail: 0}`
  - 服务器 `bash scripts/watch-production-data.sh` 看到该组心率到达
- [ ] **F2. 蓝牙断线自动重连**
  - 连接成功后让手表远离手机 5 米至断线（或关手表蓝牙）
  - vConsole 期望看到：`[AutoReconnect] result=>` 后跟一个失败结果
  - 让手表再次靠近 / 重开手表蓝牙
  - 数秒内 vConsole 显示连接成功，无需用户手动操作
- [ ] **F3. App.onShow 自动重连**
  - 连接状态下退出小程序到桌面
  - 锁屏 1 分钟后再唤醒，重开小程序
  - vConsole 期望看到：`[App.onShow] 自动重连=>`
  - 不需要进连接页就能继续测心率
- [ ] **F4. 扫描白名单过滤**
  - 在公司同时打开多个非 Veepoo 蓝牙设备（手环 / AirPods / 其他厂商手表）
  - 进入连接页扫描
  - 列表只显示 `S101` / `VP-` / `VPR` 开头且 RSSI≥-75 的设备
- [ ] **F5. 扫描 30s 自动停止**
  - 进入连接页不点任何东西
  - 30 秒后自动弹出 toast `扫描结束，未找到请重试`

## Phase G：体验版/正式版区分（仅体验版交付时跑）

- [ ] **G1.** 编译运行：首页右上角显示橙色「测试版 test-2026.04.27」角标
- [ ] **G2.** 真机预览：vConsole 调试面板**自动开启**（不需要在开发者工具勾选）
- [ ] **G3.** 切换试跑（不发布）：临时把 `services/env.ts` 改 `IS_TEST_BUILD: false` → 重新编译 → 角标消失、vConsole 关闭；改回 true 提交

---

## 故障排查

### 小程序报 "request:fail url not in domain list"
- 微信开发者工具「设置 → 项目设置」勾选「不校验合法域名」

### 蓝牙扫不到设备
- 手机定位权限未开（BLE 扫描在微信上强制要求定位权限）
- 手表已被其他 App 连着 → 断开其他连接
- 手表息屏广播停止 → 按按键唤醒

### 连接成功但没数据
- 密钥认证失败 → vConsole 搜 `passwordCheck` 看是否成功
- 手表固件返回的 BLE type 码与代码不匹配
  - 心率=51，血压=18，血氧=30，体温=6
  - 在采集页面 vConsole 打断点看 `e.type`

### vConsole 看到 HTTP 失败
- 手机无网络
- `dc.ncrc.org.cn` 无法访问 → `curl https://dc.ncrc.org.cn/api2/api/status` 测试
- 域名校验没勾掉

### 数据已写入但监控面板没反应
- 监控面板默认关注 deviceId=4，检查 `TARGET_DEVICE` 环境变量
- 手动 curl 验证：
  ```bash
  curl -s https://dc.ncrc.org.cn/api2/api/data | python3 -m json.tool --no-ensure-ascii
  ```

---

## 数据归宿说明

- **真机采集数据** → `deviceId=4`（本次测试新增）
- **Demo 数据** → `deviceId=1/2/3`（保持不变）
- `dataStorage.ts` 中的 `deviceId=4` 是暂时硬编码，打通后再做动态映射（从手表 MAC 地址查 deviceId）

---

## 打通后的下一步

1. ✅ **动态 deviceId 映射**：已实现 —— `services/dataStorage.ts:resolveDeviceId()` 在 BLE 连接后调 `POST /api/device/register` 取 deviceId
2. ✅ **断网重传**：已实现 —— `enqueuePending` + `flushPending`，触发点：onShow / 网络恢复
3. **合法域名上架**：小程序正式发布前，把 `dc.ncrc.org.cn` 加到微信公众平台后台的合法 request 域名（详见 `docs/4.25plan.md` Step 10.1）
4. **数据校验**：血压/心率等值的合理性检查（如血压 < 60/40 或 > 250/180 拒绝入库）
5. **受试者编号 ↔ deviceId 绑定**：当前 `patientId` 硬编码为 1；正式上线前由六元/医生端建立映射

---

## 参考文件

- 数据采集全流程：[docs/SDK数据采集全景.md](SDK数据采集全景.md)
- BLE 连接代码：[code/demo/WeiXinSDKTSDemo/miniprogram/pages/bleConnection/index.ts](../code/demo/WeiXinSDKTSDemo/miniprogram/pages/bleConnection/index.ts)
- 心率测试代码：[code/demo/WeiXinSDKTSDemo/miniprogram/pages/heartRateTest/index.ts](../code/demo/WeiXinSDKTSDemo/miniprogram/pages/heartRateTest/index.ts)
- 数据存储服务：[code/demo/WeiXinSDKTSDemo/miniprogram/services/dataStorage.ts](../code/demo/WeiXinSDKTSDemo/miniprogram/services/dataStorage.ts)
- 监控脚本：[scripts/watch-production-data.sh](../scripts/watch-production-data.sh)
