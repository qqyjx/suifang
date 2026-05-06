#!/bin/bash
# 5.06-v6 一键部署 + 数据合并脚本
#
# 这个脚本要做三件事:
#   1. 跑 redeploy.sh 把 health_server.py v6 推到 192.168.4.104 (含启动时 ALTER TABLE 加 mac 列)
#   2. 调 POST /api/device/merge 把 deviceId=5 的所有数据合并到 deviceId=4
#   3. 调 DELETE /api/device/5 删掉 wearable_device 表的 id=5 那行 (之前 iOS UUID 飘逸生成的脏行)
#
# 必须在能 SSH 192.168.4.104 的环境跑 (PowerShell / git bash / 公司内网机器).
# WSL 默认走非公司网路由, 跑不通.
#
# 用法:
#   bash scripts/deploy-v6-and-merge.sh                 # 默认 5 -> 4
#   bash scripts/deploy-v6-and-merge.sh "8ik,(OL>"      # 同时传 SSH 密码 (没配 key 时用)
#   FROM_ID=7 TO_ID=4 bash scripts/deploy-v6-and-merge.sh   # 改合并方向 (审慎)

set -e

PASSWORD="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FROM_ID="${FROM_ID:-5}"
TO_ID="${TO_ID:-4}"
API_BASE="https://dc.ncrc.org.cn/api2"

echo "=== 5.06-v6 部署 + 数据合并 ==="
echo "  服务端:    192.168.4.104 (走 SSH)"
echo "  外网入口:  $API_BASE"
echo "  合并方向:  deviceId=$FROM_ID -> deviceId=$TO_ID"
echo

# ============ Step 1: 部署 ============
echo "[Step 1/4] 跑 redeploy.sh 推 health_server.py v6"
if [ -n "$PASSWORD" ]; then
    bash "$SCRIPT_DIR/redeploy.sh" "$PASSWORD"
else
    bash "$SCRIPT_DIR/redeploy.sh"
fi

# ============ Step 2: 等服务起来 + 验证 merge endpoint 出现 ============
echo
echo "[Step 2/4] 验证服务端 v6 已生效 (merge endpoint 出现)"
sleep 4
INDEX_BODY=$(curl -s --max-time 8 "$API_BASE/")
if echo "$INDEX_BODY" | grep -q "/api/device/merge"; then
    echo "  ✅ merge endpoint 已注册"
else
    echo "  ❌ merge endpoint 未出现. 服务端可能没起来. 输出:"
    echo "  $INDEX_BODY"
    exit 1
fi

STATUS_BODY=$(curl -s --max-time 8 "$API_BASE/api/status")
echo "  /api/status: $STATUS_BODY"

# ============ Step 3: 合并 FROM_ID -> TO_ID ============
echo
echo "[Step 3/4] 合并 deviceId=$FROM_ID 到 deviceId=$TO_ID"
echo "  请求: POST /api/device/merge {fromDeviceId:$FROM_ID, toDeviceId:$TO_ID}"
MERGE_BODY=$(curl -s --max-time 15 -X POST "$API_BASE/api/device/merge" \
    -H "Content-Type: application/json" \
    -d "{\"fromDeviceId\":$FROM_ID,\"toDeviceId\":$TO_ID}")
echo "  响应: $MERGE_BODY"
if ! echo "$MERGE_BODY" | grep -q '"success": *true'; then
    echo "  ❌ merge 失败, 请人工检查. 不继续删除."
    exit 1
fi
echo "  ✅ merge 完成"

# ============ Step 4: 删 wearable_device.id=FROM_ID ============
echo
echo "[Step 4/4] 删 wearable_device.id=$FROM_ID (此时 wearable_device_data 已被 merge 删完, DELETE 只清 device 表)"
DEL_BODY=$(curl -s --max-time 10 -X DELETE "$API_BASE/api/device/$FROM_ID")
echo "  响应: $DEL_BODY"
if ! echo "$DEL_BODY" | grep -q '"success": *true'; then
    echo "  ❌ 删除 wearable_device.id=$FROM_ID 失败, 请人工检查"
    exit 1
fi
echo "  ✅ wearable_device.id=$FROM_ID 已删除"

# ============ 收尾验证 ============
echo
echo "=== 部署 + 合并完成 ==="
FINAL_STATUS=$(curl -s --max-time 8 "$API_BASE/api/status")
echo "  最终 /api/status: $FINAL_STATUS"
echo "  小程序端: env.ts BUILD_TAG=5.06-v6 已 commit, 重新编译上传体验版即可"
