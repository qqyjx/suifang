# 智能随访小程序 BLE — 常见问题清单 (FAQ)

> 基于 2026-04-27 体验版联调实战沉淀。每条都标注"现象 / 根因 / 解决"，让下次同样问题 1 分钟解决。

## 目录

- [一、BLE 连接异常](#一ble-连接异常)
- [二、数据没上传 / 数据库异常](#二数据没上传--数据库异常)
- [三、开发部署网络](#三开发部署网络)
- [四、版本管理与体验版发布](#四版本管理与体验版发布)
- [五、常用诊断命令](#五常用诊断命令)

---

## 一、BLE 连接异常

### Q1. 设备扫描列表空白，30 秒提示"附近无可连接的设备"

**现象**：bleConnection 页面进入后一直显示"正在搜索附近的设备…"，列表里啥都没有。vConsole 里 `adapterState available:true discovering:true` 但**没有任何 `[BLE scan]` 或 `[BLE raw found]` 日志**。

**根因（按概率排）**：
1. **iOS 系统蓝牙独占了广播**（最常见）：iOS 一旦在「我的设备」配过对该设备，App 层拿不到广播包
2. 手表正被其他 App / 其他手机连着，不再广播
3. 手表息屏后停止广播省电
4. 微信蓝牙权限没开

**解决**：
1. iOS「设置 → 蓝牙 → 我的设备」找 S101 → ⓘ → **忽略此设备**
2. 摇亮手表 → 立即点扫描（5 秒内）
3. iOS「设置 → 微信 → 蓝牙」打开
4. 极端情况：手表关机重开

> ⚠️ Veepoo 设计上**不需要**走 iOS 系统配对，全程靠 BLE 广播 + App 层连接。一旦系统配对就会卡死。

---

### Q2. 设备列表里能看到 S101，点了之后"连接中"loading 永远转

**现象**：扫到设备 → 点击 → loading 转圈不停 → 30 秒后 scan timer 弹"附近无设备"。

vConsole 看到 `getBLEMTU:ok mtu:512` 但 **`deviceChipStatus===> ` 永远没值**，`VPDevice ==> null`。

**根因**：BLE 物理通道建立了（MTU 协商成功），但 Veepoo SDK 的**密钥核准链路断了**，`type=1` 回调没到达，`deviceChipStatus` 没被 SDK 写入 → bleConnection 的 setInterval 永等。

**解决**（不是代码问题，是手表/系统状态）：
1. iOS 蓝牙忽略 S101（同 Q1）
2. **手表关机重开**（80% 的 BLE 卡死状态可解）
3. 关掉其他正在连这只手表的 App / 手机
4. v5+ 已加 10 秒超时模态：等 10 秒会弹引导框

**代码位置**：[pages/bleConnection/index.ts](../code/demo/WeiXinSDKTSDemo/miniprogram/pages/bleConnection/index.ts) 的 `connectBle` setInterval 段。

---

### Q3. 重连成功后只显示设备名 S101，MAC/版本/电量/步数全空白

**现象**：小程序切后台再回前台，首页能看到「设备名称：S101」，但 MAC、固件版本、电池电量、实时步数四行全是空。

**根因**：`app.ts onShow` 调了 `BleReconnectDeviceManager` 让 BLE 物理通道恢复，但**没调 `veepooBlePasswordCheckManager()`**。Veepoo SDK 强制要求 "BLE 连接 → 密钥核准 → 才推 type=1 (含 VPDeviceMAC/版本) 等回调"，bleConnection 首次连接走全了，onShow 漏一半。

**解决**：已在 v4+ 修复（commit `a218c17`）。onShow 重连成功后 500ms 补调 `veepooBlePasswordCheckManager`，pullHistory 顺延到 2500ms。

**代码位置**：[app.ts](../code/demo/WeiXinSDKTSDemo/miniprogram/app.ts) onShow 中的密钥核准 setTimeout。

---

### Q4. 点「断开连接」后再去搜索，扫不到手表

**现象**：首页点「断开连接」→ 进设备扫描 → 列表空白。

**根因**：旧版 `closeBluetoothAdapterManager` 只调了 jieli SDK 断开 + 置 UI 灰，**没真断 Veepoo BLE 通道**。手表协议层认为还连着 → 不再广播 → 微信 `onBluetoothDeviceFound` 拿不到回调。

**解决**：已在 v4+ 修复（commit `a218c17` + `35c5c43`）：
- `wx.closeBLEConnection` 真断通道
- 清 `dataStorage` deviceId 缓存
- bleInfo 保留（不清成 null，避免触发 Q5）
- Toast 提示用户「已断开」

---

### Q5. 主动断开后小程序崩溃 / 首页卡白 / TypeError null

**现象**：vConsole 红字 `TypeError: null is not an object (evaluating 'wx.getStorageSync("bleInfo").deviceId')` ，整个 onShow 抛异常 → 首页布局全崩。

**根因**：曾经的"主动断开后清 `bleInfo=null`"设计，但项目里 7 处代码（`index/getConnectedBleDevice`、`otaNavite`、`dial`、`networkDial`、`ota`、`bleConnection` 等）直接读 `bleInfo.deviceId` 没做 null 防御。

**解决**：已在 v4 修复（commit `35c5c43`）：
- 不再清 `bleInfo`，bleInfo 始终保留
- 产品判断"没连好就重连就行"，不需要锁死自动重连
- 首次安装场景下 `bleInfo` 也是 null，必须保留 null 防御 `if (bleInfo && bleInfo.deviceId)`

---

## 二、数据没上传 / 数据库异常

### Q6. 手表测了血压/血氧/体温但 MySQL 里看不到

**现象**：手表上点开始测，数值正常出来，但 `curl https://dc.ncrc.org.cn/api2/api/data` 看不到新数据。

**根因（按概率排）**：
1. **小程序在后台/被关闭** → 微信小程序硬限制无法后台常驻 BLE，BLE 通道断 → 数据没法实时上传
2. 用户没主动进对应的测量页面（如 `universalBlood`），SDK 默认不主动推（已在 v3+ 修复，bleHub 全局自动同步）
3. 密钥核准失败导致 SDK 通讯链没起来（参见 Q3）

**解决**：
- v3+ 已经做"手表本地缓存 3 天 + 小程序打开自动拉历史"机制，用户全程不需要进子页面
- 用户操作：**任何时刻打开小程序首页 → onShow 自动重连 → bleHub 拉 3 天日常数据 → 自动 saveData**
- 边界：手表只缓存 3 天，超过会丢；ECG 例外（必须身体形成导联回路，物理限制）

**代码位置**：[services/bleHub.ts](../code/demo/WeiXinSDKTSDemo/miniprogram/services/bleHub.ts) `pullHistoryFromWatch()`。

---

### Q7. 同一只手表在 `wearable_device` 表里出现多行（dev_id 飘逸）

**现象**：`SELECT * FROM wearable_device WHERE device_sign LIKE 'S101_%'` 返回多条记录，每条 `device_sign` 不一样（一条是 MAC，一条是 UUID）。

**根因**：
- 旧版 `device_sign = "S101_${bleInfo.deviceId}"`
- iOS 上 `bleInfo.deviceId` 是**系统代理 UUID**（如 `7AD4A474-9CBD-...`），每次重装小程序甚至每次重连都可能变
- Android 上是真 MAC（如 `FA:BA:94:8A:70:75`）
- 同一只手表在 iOS/Android 跨平台、或 iOS 重装时被注册成新行

**解决**：已在 v3+ 修复（commit `a456775`）：
1. bleHub 抓 `type=1` 回调里的 `VPDeviceMAC`（手表真 MAC，跨平台一致）写到 `bleInfo.mac`
2. `dataStorage.resolveDeviceId()` 优先用 `bleInfo.mac` 当 sign，降级才用 `bleInfo.deviceId`

**清理脏数据**：
```bash
# 找出该手表所有飘逸行
curl "https://dc.ncrc.org.cn/api2/api/device/by-sign?sign=S101_FA:BA:94:8A:70:75"
# 调 DELETE 清理（联动删 wearable_device + wearable_device_data）
curl -X DELETE https://dc.ncrc.org.cn/api2/api/device/<id>
```

---

### Q8. 患者多用户多设备并发会不会互相串数据？

**不会**。每只手表的 `device_sign = "S101_<真MAC>"` 唯一映射 `wearable_device` 一行。多手机连同一手表（不同时）都命中同一 deviceId；多手机各连各的手表，每只手表唯一 deviceId。

需要患者绑定身份的场景，靠 `patientId` 字段（当前默认 1，等医生端集成时由六元 `patients` 表分配）。

---

## 三、开发部署网络

### Q9. WSL 里运行 redeploy.sh 卡死在 `[1/5] 备份现有 health_server.py`

**现象**：在 WSL 里跑 `bash scripts/redeploy.sh` 几分钟没动静，按 Ctrl+C 才能停。

**根因**：
- 脚本走 SSH 到 192.168.4.104，但 WSL 走不到公司内网
- 公司内网 192.168.4.x 是通过 **DPtech SSL VPN** 接入的，VPN 客户端装在 Windows 主机
- WSL2 即使开了 `mirrored` 网络模式，**也不继承第三方 SSL VPN 的 TUN 路由** —— 这是已知限制不是 bug
- 验证：`ping 192.168.4.104` 在 WSL 不通、在 Windows PowerShell 通

**解决**：所有公司内网部署操作走 **Windows PowerShell**，不要在 WSL 里跑 SSH 到 192.168.4.x。

参考 [Q11 部署模板](#q11-完整部署流程powershell-版)。

---

### Q10. WSL 里的文件复制到 Windows 路径报 `cp: cannot create regular file ...: Not a directory`

**现象**：
```powershell
wsl -e cp /home/qq/suifang/.../health_server.py "C:\Users\xxx\Temp\..."
# cp: cannot create regular file 'C:\...': Not a directory
```

**根因**：WSL 里的 `cp` 不认识 Windows 反斜杠路径。

**解决（两种）**：

**A. WSL 里用 Linux 风格路径**（Windows 盘符在 WSL 是 `/mnt/c/`）：
```powershell
wsl bash -c "cp /home/qq/suifang/.../health_server.py /mnt/c/Users/xxx/Temp/"
```

**B. PowerShell 通过 `\\wsl$\` UNC 路径直接读 WSL 文件**（推荐，无需 wsl 命令）：
```powershell
$distro = "Ubuntu"  # wsl -l -q 第一行的名字
Copy-Item "\\wsl$\$distro\home\qq\suifang\WeChat_Mini_Program_Ble_SDK\scripts\health_server.py" $env:TEMP\
```

---

### Q11. 完整部署流程（PowerShell 版）

```powershell
$tmp = "$env:TEMP\suifang-deploy"
mkdir $tmp -Force | Out-Null

# 1. WSL 文件 → Windows 临时目录
$distro = (wsl -l -q | Select-Object -First 1).Trim()
Copy-Item "\\wsl$\$distro\home\qq\suifang\WeChat_Mini_Program_Ble_SDK\scripts\health_server.py" $tmp\
Copy-Item "\\wsl$\$distro\home\qq\suifang\WeChat_Mini_Program_Ble_SDK\scripts\suifang.service"  $tmp\

# 2. scp 上传 + 重启服务（DPtech VPN 连着的状态下）
scp $tmp\health_server.py root@192.168.4.104:/opt/suifang/
scp $tmp\suifang.service  root@192.168.4.104:/etc/systemd/system/
ssh root@192.168.4.104 "systemctl daemon-reload && systemctl restart suifang && sleep 1 && curl -s http://localhost:3000/"

# 3. 外网验证
curl https://dc.ncrc.org.cn/api2/api/status
```

最后 curl 应返回 `{"status":"running","mysql":"connected",...}`，且 endpoints 列表里包含 `DELETE /api/device/:id`。

---

### Q12. 微信开发者工具模拟器报蓝牙错 / `stopBluetoothDevicesDiscovery:fail`

**现象**：模拟器里蓝牙相关 API 报错，红字一片。

**根因**：微信开发者工具明确告知**蓝牙调试只支持 Mac**，Windows/Linux 模拟器没有真蓝牙。

**解决**：忽略，所有 BLE 相关测试**必须用真机**：
- 工具栏「预览」→ 出开发版二维码 → 手机扫
- 或「真机调试」→ 出二维码 → 手机扫 → 工具里能实时看 console

---

## 四、版本管理与体验版发布

### Q13. 修了代码但手机上行为没变 / "我刚 push 了为啥不生效"

**最常见的认知误区。** 链路有三段，git push **只完成第一段**：

```
WSL 改代码 → git push → GitHub
                          ↓ 还要做
                微信开发者工具 编译 → 上传 → mp.weixin 选为体验版
                          ↓
                      手机扫体验版二维码
```

**判断手机上是不是新版**：进首页 → 看右上角橙色角标 `BUILD_TAG`。

| 角标 | 含义 |
|------|------|
| `test-2026.04.27-v3` | 含 MAC 优先、自动同步 |
| `test-2026.04.27-v4` | 含 v3 + 重连密钥核准 + 真断 BLE + null 防御 |
| `test-2026.04.27-v5` | 含 v4 + 连接超时 10s 模态引导 |

每次有改动 push 后必做：

```
1. 改 services/env.ts 里的 BUILD_TAG（v5→v6 等）
2. 微信开发者工具 Ctrl+B 编译
3. 工具栏「上传」填新版本号（如 0.2.4）
4. mp.weixin.qq.com → 管理 → 版本管理 → 开发版本 → 找新版 → 选为体验版
5. 手机扫体验版二维码 → 看角标确认
```

---

### Q14. 微信开发者工具的项目和 WSL 同步吗？

**取决于导入项目时的路径**：

| 导入路径 | 同步情况 |
|---------|---------|
| `\\wsl$\Ubuntu\home\qq\suifang\...` | ✅ **同步**。WSL 改文件，开发者工具立刻看到（点编译刷新即可） |
| `C:\xxx\suifang\...`（git clone 到 Windows 盘） | ❌ 不同步。WSL push 后 Windows 那边要 `git pull` |

**推荐**：从 `\\wsl$\` 导入更省事，不用维护两份。代价：编译稍慢（WSL FS IO）。

---

### Q15. 体验版扫码报"无权访问"

**根因**：扫码者的微信号没在体验成员列表。

**解决**：mp.weixin.qq.com → 成员管理 → **体验成员** → 添加微信号。每个小程序默认上限 90 个体验成员。

---

### Q16. 上传报错 "find module 'xxx'" / 包体积超限

| 错误 | 修法 |
|------|------|
| `find module 'xxx'` | 详情→项目设置 开 ✅ 使用 npm 模块；工具栏「工具→构建 npm」 |
| 上传体积超 2MB | 检查 `dist` / `node_modules` 没打进包；`miniprogram` 目录别引用 `node_modules` 里的东西 |
| AppID 报错 | 必须用注册了该 AppID 的微信号扫码登录开发者工具 |

---

## 五、常用诊断命令

### 生产端健康检查

```bash
# 服务存活 + MySQL 连接
curl https://dc.ncrc.org.cn/api2/api/status

# 列出所有设备数据
curl https://dc.ncrc.org.cn/api2/api/data | python3 -m json.tool

# 看现存 deviceId
curl -s https://dc.ncrc.org.cn/api2/api/data | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('deviceId 列表:', sorted({r['deviceId'] for r in d.get('records',[])}))
"

# 按 sign 查设备元数据
curl "https://dc.ncrc.org.cn/api2/api/device/by-sign?sign=S101_FA:BA:94:8A:70:75"

# 删脏设备（含历史数据）
curl -X DELETE https://dc.ncrc.org.cn/api2/api/device/<id>
```

### 服务端登录排错

```powershell
# Windows PowerShell（DPtech VPN 连着）
ssh root@192.168.4.104 "systemctl status suifang --no-pager | head -10"
ssh root@192.168.4.104 "journalctl -u suifang -n 50 --no-pager"
```

### 真机 vConsole 关键日志关键字

| 关键字 | 含义 |
|--------|------|
| `[BleHub] 全局事件中心已初始化` | bleHub 启动成功 |
| `[BleHub] 捕获手表 MAC=...` | type=1 密钥核准成功，MAC 已写入 bleInfo |
| `[BleHub] 触发拉历史 day=0/1/2` | 拉手表本地缓存 3 天数据 |
| `[BleHub] 自动同步 type=18 -> bloodPressure` | 血压自动 saveData |
| `[App.onShow] 自动重连=> {connection: true}` | 后台返回前台自动重连成功 |
| `[DataStorage] HTTP同步xxx成功 (deviceId=N)` | 数据上传到生产 MySQL 成功 |
| `[DataStorage] HTTP同步xxx失败入队待补传` | 上传失败，进 pending 队列下次补传 |

### 健全性自查（每次发版前）

1. 真机扫体验版二维码，**右上角角标** = 当前 BUILD_TAG ✅
2. 进设备扫描页 → 看到 S101 → 点击连接 → 进首页有 MAC/版本/电量
3. 手表测一次血压 → 退出小程序 → 重新进 → 数据自动同步上去
4. `curl /api/data` 看到新血压数据
5. 主动断开 → 进扫描 → 还能搜到 S101

任意一条失败 → 看本 FAQ 对应章节。

---

**最后更新**：2026-04-27 v5 联调完成
**当前生产服务端**：`192.168.4.104:3000` (六元) → MySQL `192.168.4.174 / h6dp_suifang`
**当前 GitHub**：https://github.com/qqyjx/suifang `main` 分支
