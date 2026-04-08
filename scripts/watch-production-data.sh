#!/bin/bash
# 实时监控生产数据库状态
# 用于真机测试时观察数据是否到达六元 MySQL
#
# 用法: bash scripts/watch-production-data.sh [interval]
#       interval 默认 2 秒

set -e

INTERVAL="${1:-2}"
API_URL="https://dc.ncrc.org.cn/api2/api/data"
# 真机测试占用 deviceId=4（demo 数据在 1/2/3）
TARGET_DEVICE="${TARGET_DEVICE:-4}"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

trap 'echo -e "\n${YELLOW}监控已停止${NC}"; exit 0' INT

echo -e "${BOLD}${BLUE}=== 六元 MySQL 实时监控 ===${NC}"
echo -e "API:          ${CYAN}${API_URL}${NC}"
echo -e "关注设备:     ${CYAN}deviceId=${TARGET_DEVICE}${NC}"
echo -e "刷新间隔:     ${CYAN}${INTERVAL}秒${NC}"
echo -e "按 ${YELLOW}Ctrl+C${NC} 停止\n"

LAST_COUNTS=""

while true; do
    TIMESTAMP=$(date +%H:%M:%S)
    RESPONSE=$(curl -s --max-time 5 "$API_URL" 2>&1 || echo "CURL_FAIL")

    if [ "$RESPONSE" = "CURL_FAIL" ]; then
        echo -e "${RED}[$TIMESTAMP] ✗ API 请求失败${NC}"
        sleep "$INTERVAL"
        continue
    fi

    # 用 python 解析并渲染
    CURRENT=$(echo "$RESPONSE" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception as e:
    print('PARSE_ERROR:', e)
    sys.exit(1)

total = d.get('count', 0)
target_id = int('${TARGET_DEVICE}')
lines = []
lines.append(f'共 {total} 台设备在线')

# 所有设备概览
for r in d.get('records', []):
    dev_id = r['deviceId']
    tc = r.get('typeCounts', {})
    summary = ' '.join(f'{k}:{v}' for k, v in sorted(tc.items()))
    marker = '★' if dev_id == target_id else ' '
    lines.append(f'  {marker} 设备{dev_id}: {summary}  [{r[\"createTime\"]}]')

# 关注的目标设备的最新数据
target = next((r for r in d.get('records', []) if r['deviceId'] == target_id), None)
if target:
    data = target.get('data', {})
    lines.append('')
    lines.append(f'  [设备{target_id} 最新一条]')
    for key in ['心率', '血氧', '血压', '体温', '血糖', '血液成分', '身体成分', '心电', '步数', '睡眠']:
        arr = data.get(key, [])
        if arr:
            latest = arr[-1]
            fields = {k: v for k, v in latest.items() if k != '采集时间'}
            time_str = latest.get('采集时间', '')[:19]
            lines.append(f'    {key}({len(arr)}): {fields}  @ {time_str}')
else:
    lines.append('')
    lines.append(f'  [设备{target_id}] 尚无数据（等待真机采集...）')

print('\\n'.join(lines))
" 2>&1)

    clear
    echo -e "${BOLD}${BLUE}=== 六元 MySQL 实时监控 ===${NC}  ${CYAN}${TIMESTAMP}${NC}"
    echo -e "${BOLD}关注设备${NC}: ${YELLOW}deviceId=${TARGET_DEVICE}${NC} (★)"
    echo
    echo "$CURRENT"
    echo
    echo -e "${YELLOW}刷新间隔 ${INTERVAL}秒，Ctrl+C 停止${NC}"

    sleep "$INTERVAL"
done
