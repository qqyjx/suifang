#!/bin/bash
# 重新部署 health_server.py + suifang.service 到公司服务器 192.168.4.104
# 改动一致，避免每次部署都要校对 unit 文件
#
# 用法（PowerShell / git bash / 任何能 SSH 192.168.4.104 的环境）：
#   bash scripts/redeploy.sh
#
# 认证：服务器已配 ~/.ssh/id_ed25519 免密（详见 docs/服务器运维.md），
# 如果在新机器上没配过 key，传密码作为第一参数：
#   bash scripts/redeploy.sh "8ik,(OL>"

set -e

SERVER="192.168.4.104"
USER="root"
PASSWORD="${1:-}"
SUIFANG_DIR="/opt/suifang"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_PY="$SCRIPT_DIR/health_server.py"
LOCAL_UNIT="$SCRIPT_DIR/suifang.service"

if [ ! -f "$LOCAL_PY" ]; then
    echo "ERROR: 找不到 $LOCAL_PY"
    exit 1
fi
if [ ! -f "$LOCAL_UNIT" ]; then
    echo "ERROR: 找不到 $LOCAL_UNIT"
    exit 1
fi

echo "=== 智能随访服务部署 ==="
echo "目标:    $USER@$SERVER:$SUIFANG_DIR/"
echo "Python:  $LOCAL_PY"
echo "Service: $LOCAL_UNIT"
echo

# 选择 SSH/SCP 方式：优先用 key（默认），有密码就用 sshpass
if [ -n "$PASSWORD" ]; then
    if ! command -v sshpass &>/dev/null; then
        echo "提示: 系统没装 sshpass，但你传了密码——会提示交互输入"
        echo "Ubuntu/Debian: apt install sshpass"
        SSH_CMD="ssh -o StrictHostKeyChecking=no"
        SCP_CMD="scp -o StrictHostKeyChecking=no"
    else
        SSH_CMD="sshpass -p '$PASSWORD' ssh -o StrictHostKeyChecking=no"
        SCP_CMD="sshpass -p '$PASSWORD' scp -o StrictHostKeyChecking=no"
    fi
else
    # 默认走 key（id_ed25519 已配好）
    SSH_CMD="ssh -o StrictHostKeyChecking=no"
    SCP_CMD="scp -o StrictHostKeyChecking=no"
fi

# Step 1: 备份服务器上的现版本
echo "[1/5] 备份现有 health_server.py（如果有）"
eval "$SSH_CMD $USER@$SERVER \"mkdir -p $SUIFANG_DIR && [ -f $SUIFANG_DIR/health_server.py ] && cp $SUIFANG_DIR/health_server.py $SUIFANG_DIR/health_server.py.bak.\$(date +%Y%m%d_%H%M%S) && echo '已备份' || echo '(无旧文件，跳过备份)'\""

# Step 2: 上传 Python 主程序
echo
echo "[2/5] 上传 health_server.py"
eval "$SCP_CMD '$LOCAL_PY' $USER@$SERVER:$SUIFANG_DIR/health_server.py"

# Step 3: 上传 systemd unit（与仓库内 scripts/suifang.service 一致）
echo
echo "[3/5] 上传 suifang.service"
eval "$SCP_CMD '$LOCAL_UNIT' $USER@$SERVER:/etc/systemd/system/suifang.service"

# Step 4: 杀旧进程 + reload + restart
echo
echo "[4/5] 重启服务"
eval "$SSH_CMD $USER@$SERVER \"pkill -9 -f health_server.py 2>/dev/null; sleep 2; systemctl daemon-reload && systemctl enable suifang && systemctl restart suifang && sleep 3 && systemctl status suifang --no-pager | head -15\""

# Step 5: 验证
echo
echo "[5/5] 服务状态"
eval "$SSH_CMD $USER@$SERVER \"tail -20 $SUIFANG_DIR/server.log; echo '---'; curl -s http://localhost:3000/api/status\""

echo
echo "=== 部署完成。从外网验证 ==="
echo "curl -s https://dc.ncrc.org.cn/api2/api/status            # 期望 mysql:connected, total_devices:>=12"
echo "curl -s https://dc.ncrc.org.cn/api2/                      # 期望 endpoints 含 device/register"
echo "curl -X POST https://dc.ncrc.org.cn/api2/api/device/register \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"deviceSign\":\"S101_FA:BA:94:8A:70:75\",\"type\":1}'  # 期望 deviceId:4"
