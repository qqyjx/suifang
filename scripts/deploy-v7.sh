#!/bin/bash
# 5.06-v7 一键部署脚本: 写 WX_APPSECRET 到服务器 + 部署 health_server.py + 验证
#
# 必须在能 SSH 192.168.4.104 的环境跑 (PowerShell Claude Code 或公司内网机).
#
# 用法:
#   bash scripts/deploy-v7.sh                 # 交互式输入 AppSecret (推荐, 不留 shell history)
#   bash scripts/deploy-v7.sh '<APPSECRET>'   # 快但 AppSecret 会进 ps aux / history
#
# AppSecret 来源: mp.weixin.qq.com → 开发管理 → 开发设置 → AppSecret(小程序密钥) → 重置/查看
# 注意: 重置 AppSecret 会立即失效旧值, 已上线小程序若有用旧值的依赖会瞬间失败.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER="192.168.4.104"
USER="root"
WX_ENV_PATH="/opt/suifang/wx.env"

# ============ 1. 拿 AppSecret ============
APPSECRET="${1:-}"
if [ -z "$APPSECRET" ]; then
    echo -n "粘贴 WX_APPSECRET (输入隐藏, 回车结束): "
    read -rs APPSECRET
    echo
fi
if [ -z "$APPSECRET" ]; then
    echo "ERROR: AppSecret 不能为空"
    exit 1
fi
if [ ${#APPSECRET} -lt 16 ]; then
    echo "WARN: AppSecret 长度仅 ${#APPSECRET} 字符, 像是写错了 (官方 32 字符), 继续? [y/N]"
    read -r yn
    [ "$yn" = "y" ] || exit 1
fi

# ============ 2. 写 wx.env 到服务器 ============
echo "[1/3] 写 $WX_ENV_PATH (chmod 600)"
echo "WX_APPSECRET=$APPSECRET" | ssh -o StrictHostKeyChecking=no "$USER@$SERVER" \
    "mkdir -p /opt/suifang && cat > $WX_ENV_PATH && chmod 600 $WX_ENV_PATH && echo '  written, $(wc -c < $WX_ENV_PATH) bytes'"

# ============ 3. 跑 redeploy.sh ============
echo
echo "[2/3] 部署 health_server.py + suifang.service"
bash "$SCRIPT_DIR/redeploy.sh"

# ============ 4. 验证 ============
echo
echo "[3/3] 验证 v7 上线"
sleep 4
INDEX=$(curl -s --max-time 8 https://dc.ncrc.org.cn/api2/)
echo "  endpoints: $(echo "$INDEX" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(", ".join(d.get("endpoints",{}).keys()))' 2>/dev/null || echo '解析失败')"
if echo "$INDEX" | grep -q "/api/wx/login"; then
    echo "  ✅ /api/wx/login endpoint 已注册"
else
    echo "  ❌ /api/wx/login 未出现, 服务端可能没起来. INDEX 原文:"
    echo "$INDEX"
    exit 1
fi

# 试调一次假 code, 期望 400 (jscode2session 拒绝), 但不应是 'WX_APPSECRET 未配置'
PROBE=$(curl -s --max-time 8 -X POST https://dc.ncrc.org.cn/api2/api/wx/login \
    -H 'Content-Type: application/json' \
    -d '{"code":"__probe_invalid_code__"}')
echo "  /api/wx/login probe 响应: $PROBE"
if echo "$PROBE" | grep -q "WX_APPSECRET 未配置"; then
    echo "  ❌ AppSecret 没注入到 systemd 进程. 可能 EnvironmentFile 未生效."
    echo "     检查: ssh $USER@$SERVER 'systemctl show suifang -p Environment'"
    exit 1
fi
echo "  ✅ AppSecret 已注入 (probe 走到了微信端校验, 不是配置缺失)"

echo
echo "=== v7 部署完成 ==="
echo "  小程序端: env.ts BUILD_TAG=5.06-v7 已 commit, 重新编译上传体验版即可"
echo "  数据切片: GET /api/data?wxOpenid=<openid>  仅看该微信号数据"
echo "          GET /api/data?wxOpenid=NULL       仅看历史未分组数据"
