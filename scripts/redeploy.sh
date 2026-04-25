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
NEW_MYSQL_IP="192.168.4.174"
OLD_MYSQL_IP="192.168.4.222"
SUIFANG_DIR="/opt/suifang"

echo "=== 智能随访服务重新部署 ==="
echo "目标: $USER@$SERVER"
echo "MySQL: $NEW_MYSQL_IP"
echo

if ! command -v sshpass &>/dev/null; then
    echo "提示: 系统没装 sshpass，将用交互式 ssh（每条命令都要输密码）"
    echo "Ubuntu/Debian 装法: apt install sshpass"
    SSH_CMD="ssh"
else
    SSH_CMD="sshpass -p '$PASSWORD' ssh -o StrictHostKeyChecking=no"
fi

# Step 1: 替换 IP（如果还是旧 IP）
echo "[1/4] 替换 MySQL IP $OLD_MYSQL_IP -> $NEW_MYSQL_IP"
eval "$SSH_CMD $USER@$SERVER \"sed -i 's/$OLD_MYSQL_IP/$NEW_MYSQL_IP/g' $SUIFANG_DIR/health_server.py && grep '192.168' $SUIFANG_DIR/health_server.py | head -3\""

# Step 2: 创建 systemd service（重启后自动起来）
echo
echo "[2/4] 创建 systemd service"
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

# Step 3: 杀掉旧进程，启动 systemd 服务
echo
echo "[3/4] 重启服务"
eval "$SSH_CMD $USER@$SERVER \"pkill -9 -f health_server.py 2>/dev/null; sleep 2; systemctl daemon-reload && systemctl enable suifang && systemctl restart suifang && sleep 3 && systemctl status suifang --no-pager | head -15\""

# Step 4: 验证
echo
echo "[4/4] 验证服务状态"
eval "$SSH_CMD $USER@$SERVER \"tail -20 $SUIFANG_DIR/server.log; echo '---'; curl -s http://localhost:3000/api/status\""

echo
echo "=== 部署完成。从外网验证: ==="
echo "curl -s https://dc.ncrc.org.cn/api2/api/status"
