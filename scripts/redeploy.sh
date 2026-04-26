#!/bin/bash
# 重新部署 health_server.py 到公司服务器 192.168.4.104
# 同时安装为 systemd service，避免重启后服务丢失
#
# 用法（在 Windows PowerShell 或任何能 SSH 192.168.4.104 的环境）：
#   bash scripts/redeploy.sh [可选: 新的 root 密码]
#
# 默认密码 8ik,(OL>，如果改了就传新密码

set -e

SERVER="192.168.4.104"
USER="root"
PASSWORD="${1:-8ik,(OL>}"
SUIFANG_DIR="/opt/suifang"
LOCAL_PY="$(dirname "$0")/health_server.py"

if [ ! -f "$LOCAL_PY" ]; then
    echo "ERROR: 找不到本地 health_server.py: $LOCAL_PY"
    exit 1
fi

echo "=== 智能随访服务重新部署 ==="
echo "目标: $USER@$SERVER:$SUIFANG_DIR/"
echo "源: $LOCAL_PY"
echo "MySQL: 192.168.4.174 (写在 health_server.py 里)"
echo

if ! command -v sshpass &>/dev/null; then
    echo "提示: 系统没装 sshpass，将用交互式 ssh（每条命令都要输密码）"
    echo "Ubuntu/Debian 装法: apt install sshpass"
    SSH_CMD="ssh -o StrictHostKeyChecking=no"
    SCP_CMD="scp -o StrictHostKeyChecking=no"
else
    SSH_CMD="sshpass -p '$PASSWORD' ssh -o StrictHostKeyChecking=no"
    SCP_CMD="sshpass -p '$PASSWORD' scp -o StrictHostKeyChecking=no"
fi

# Step 1: 备份服务器上的现版本
echo "[1/5] 备份现有 health_server.py"
eval "$SSH_CMD $USER@$SERVER \"mkdir -p $SUIFANG_DIR && [ -f $SUIFANG_DIR/health_server.py ] && cp $SUIFANG_DIR/health_server.py $SUIFANG_DIR/health_server.py.bak.\$(date +%Y%m%d_%H%M%S) || echo '(无旧文件，跳过备份)'\""

# Step 2: 上传新版（含 register/by-sign API + 174 IP）
echo
echo "[2/5] 上传新版 health_server.py（含 register API + 新 MySQL IP 174）"
eval "$SCP_CMD '$LOCAL_PY' $USER@$SERVER:$SUIFANG_DIR/health_server.py"

# Step 3: 创建 systemd service（重启后自动起来）
echo
echo "[3/5] 安装 systemd service（自启 + 失败重启）"
eval "$SSH_CMD $USER@$SERVER \"cat > /etc/systemd/system/suifang.service\" << 'EOF'
[Unit]
Description=智能随访数据接收服务
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/suifang
ExecStart=/usr/bin/python3 /opt/suifang/health_server.py
Restart=on-failure
RestartSec=5
StandardOutput=append:/opt/suifang/server.log
StandardError=append:/opt/suifang/server.log

[Install]
WantedBy=multi-user.target
EOF"

# Step 4: 杀旧进程 + 启动 systemd 服务
echo
echo "[4/5] 重启服务"
eval "$SSH_CMD $USER@$SERVER \"pkill -9 -f health_server.py 2>/dev/null; sleep 2; systemctl daemon-reload && systemctl enable suifang && systemctl restart suifang && sleep 3 && systemctl status suifang --no-pager | head -15\""

# Step 5: 验证
echo
echo "[5/5] 验证服务状态"
eval "$SSH_CMD $USER@$SERVER \"tail -20 $SUIFANG_DIR/server.log; echo '---'; curl -s http://localhost:3000/api/status; echo; curl -s http://localhost:3000/ | head -1\""

echo
echo "=== 部署完成。从外网验证: ==="
echo "curl -s https://dc.ncrc.org.cn/api2/api/status            # 期望 mysql:connected, total_devices:>0"
echo "curl -s https://dc.ncrc.org.cn/api2/                      # 期望 endpoints 含 device/register"
echo "curl -X POST https://dc.ncrc.org.cn/api2/api/device/register \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"deviceSign\":\"S101_FA:BA:94:8A:70:75\",\"type\":1}'  # 期望 deviceId:4"
