#!/usr/bin/env python3
"""
智能随访 - 可穿戴设备数据接收服务（Python 版，部署到 CentOS 7 公司服务器）

为什么不用 Node.js：CentOS 7 默认 GLIBC 太旧（2.17），mysql2 等 npm 包跑不起。
所以服务器端使用 Python + pymysql 标准库，避免依赖问题。

数据结构（一台设备一行 + 大 JSON 汇总）：
- wearable_device_data 表中每台设备只占 1 行
- data 列是大 JSON，按 10 类数据分组，每类是历史测量数组
- 新数据进来时 UPSERT：SELECT 现有行 → 解析 JSON → push 新测量 → UPDATE/INSERT

API 端点：
- GET  /api/status                       服务状态 + MySQL 连接
- GET  /api/data                         查询所有设备的大 JSON
- POST /api/health-data                  写入一条体征记录（自动 UPSERT 到大 JSON 数组）
- POST /api/device/register              按 mac (优先) 或 device_sign UPSERT 到 wearable_device，返回 deviceId
- POST /api/device/merge                 合并 wearable_device_data 两行: {fromDeviceId, toDeviceId}
- GET  /api/device/by-sign?sign=...      按 sign 查 wearable_device（不创建）
- DELETE /api/device/:id                 删 wearable_device 一行 + 联动删该 deviceId 的所有数据

部署：scp 本文件到 192.168.4.104:/opt/suifang/health_server.py，systemd 启动
"""
import json
import re
import datetime
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import pymysql

# ============ 配置 ============
PORT = 3000
DB_CONFIG = {
    'host': '192.168.4.174',
    'port': 3306,
    'user': 'developer',
    'password': 'DePer!$12967',
    'database': 'h6dp_suifang',
    'charset': 'utf8mb4',
    'connect_timeout': 5,
    'autocommit': True,
}
DEFAULT_DEVICE_ID = 1

# 数据类型 → 中文键名（10 类，未含 daily）
TYPE_TO_CHINESE = {
    'heartRate':       '心率',
    'bloodOxygen':     '血氧',
    'bloodPressure':   '血压',
    'temperature':     '体温',
    'bloodGlucose':    '血糖',
    'bloodLiquid':     '血液成分',
    'bodyComposition': '身体成分',
    'ecg':             '心电',
    'step':            '步数',
    'sleep':           '睡眠',
    'daily':           '日综合',
}

# ============ 数据库连接 ============
def get_connection():
    return pymysql.connect(**DB_CONFIG)

def test_db():
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute('SELECT COUNT(*) FROM wearable_device_data')
        count = cur.fetchone()[0]
        cur.close()
        conn.close()
        return True, count
    except Exception as e:
        return False, str(e)

def ensure_mac_column():
    """5.06-v6: 确保 wearable_device 表有 mac 列 (idempotent).

    为什么需要 mac 列: device_sign 是 'name_<MAC>' 复合, name 部分跨连接可能漂移
    ('(上次连接)' 后缀, 系统名修改等), 导致同一手表生成不同 sign 多行.
    单独的 mac 列 + 优先按 mac 查匹配, 保证一表一行.
    """
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'wearable_device' AND COLUMN_NAME = 'mac'",
            (DB_CONFIG['database'],)
        )
        if cur.fetchone()[0] == 0:
            print('[启动] wearable_device.mac 不存在, 添加中...')
            cur.execute('ALTER TABLE wearable_device ADD COLUMN mac VARCHAR(32) DEFAULT NULL')
            try:
                cur.execute('ALTER TABLE wearable_device ADD INDEX idx_mac (mac)')
            except Exception as e:
                print('[启动] mac 索引添加失败 (可忽略, 仅影响查询性能):', e)
            print('[启动] wearable_device.mac 列添加完成')
        else:
            print('[启动] wearable_device.mac 列已存在, 跳过 ALTER')
        cur.close()
    except Exception as e:
        print('[启动] ensure_mac_column 失败:', e)
    finally:
        conn.close()

# ============ 数据转换 ============
def classify_bp(systolic, diastolic):
    """血压风险分级（AHA 2017 标准）"""
    s, d = systolic or 0, diastolic or 0
    if s >= 180 or d >= 120: return '危急'
    if s >= 140 or d >= 90:  return '高血压2级'
    if s >= 130 or d >= 80:  return '高血压1级'
    if s >= 120 and d < 80:  return '偏高'
    return '正常'

def to_chinese_record(data_type, data, recorded_at=None, uploaded_at=None):
    """单条测量 → 中文字段记录（含采集时间 + 上传时间）.

    recorded_at: 客户端 saveData 调用时刻 (用户实际测量时刻);
                 客户端 ISO 8601 字符串, 如 '2026-04-29T16:33:01.000Z'.
                 不传时回退到 server 收到 POST 的时刻.
    uploaded_at: server 收到 POST 的时刻 (UTC). 由 upsert_device_data 在调用
                 本函数前固定时刻, 多类型同一批用同一值.
    """
    if data_type == 'heartRate':
        record = {'心率值': data.get('heartRate', 0), '心率状态': data.get('heartState', 0)}
    elif data_type == 'bloodOxygen':
        record = {'血氧饱和度': data.get('bloodOxygen', 0), '心率': data.get('heartRate', 0)}
    elif data_type == 'bloodPressure':
        record = {
            '高压': data.get('systolic', 0),
            '低压': data.get('diastolic', 0),
            '脉搏': data.get('heartRate', 0),
            '风险等级': classify_bp(data.get('systolic'), data.get('diastolic')),
        }
    elif data_type == 'temperature':
        record = {'体温': data.get('temperature', 0), '皮肤温度': data.get('skinTemperature', 0)}
    elif data_type == 'bloodGlucose':
        record = {'血糖值_mmol_L': data.get('bloodGlucose', 0), '餐态': data.get('mealState', '')}
    elif data_type == 'bloodLiquid':
        record = {
            '尿酸': data.get('uricAcid', 0),
            '胆固醇': data.get('cholesterol', 0),
            '甘油三酯': data.get('triacylglycerol', 0),
        }
    elif data_type == 'bodyComposition':
        record = {
            '体重': data.get('weight', 0),
            'BMI': data.get('bmi', 0),
            '体脂率': data.get('bodyFat', 0),
            '肌肉量': data.get('muscle', 0),
        }
    elif data_type == 'ecg':
        record = {
            '心率': data.get('heartRate', 0),
            '诊断': data.get('diseaseResult', ''),
            '波形采样点数': len(data.get('ecgWaveform', [])),
        }
    elif data_type == 'step':
        record = {
            '步数': data.get('step', 0),
            '卡路里': data.get('calorie', 0),
            '距离_米': data.get('distance', 0),
        }
    elif data_type == 'sleep':
        record = {
            '入睡时间': data.get('fallAsleepTime', ''),
            '醒来时间': data.get('wakeUpTime', ''),
            '深睡_分钟': data.get('deepSleepTime', 0),
            '浅睡_分钟': data.get('lightSleepTime', 0),
        }
    elif data_type == 'daily':
        record = dict(data)
    else:
        record = dict(data)
    # 采集时间: 优先用客户端 recordedAt (真实测量时刻); 缺省回退 server 收到时刻
    record['采集时间'] = recorded_at or datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')
    # 上传时间: server 收到 POST 的时刻 (一定是 server 端时刻, 防客户端时钟错乱)
    record['上传时间'] = uploaded_at or datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')
    return record

# ============ UPSERT 大 JSON 逻辑 ============
def upsert_device_data(device_id, data_type, data, recorded_at=None, uploaded_at=None):
    """一台设备一行：SELECT-merge-UPSERT"""
    chinese_key = TYPE_TO_CHINESE.get(data_type)
    if not chinese_key:
        return None, '未知数据类型: {}'.format(data_type)

    new_record = to_chinese_record(data_type, data, recorded_at=recorded_at, uploaded_at=uploaded_at)
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            'SELECT id, data FROM wearable_device_data WHERE deviceId = %s LIMIT 1',
            (device_id,)
        )
        row = cur.fetchone()

        big_json = {}
        if row and row[1]:
            try:
                big_json = json.loads(row[1])
                if not isinstance(big_json, dict):
                    big_json = {}
            except json.JSONDecodeError:
                big_json = {}

        if not isinstance(big_json.get(chinese_key), list):
            big_json[chinese_key] = []
        big_json[chinese_key].append(new_record)

        big_json_str = json.dumps(big_json, ensure_ascii=False)
        now_str = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        if row:
            cur.execute(
                'UPDATE wearable_device_data SET data = %s, createTime = %s WHERE id = %s',
                (big_json_str, now_str, row[0])
            )
            result = {
                'action': 'update',
                'rowId': row[0],
                'type': chinese_key,
                'totalTypes': len(big_json),
                'count': len(big_json[chinese_key]),
            }
        else:
            cur.execute(
                'INSERT INTO wearable_device_data (deviceId, data, createTime) VALUES (%s, %s, %s)',
                (device_id, big_json_str, now_str)
            )
            result = {
                'action': 'insert',
                'rowId': cur.lastrowid,
                'type': chinese_key,
                'totalTypes': len(big_json),
                'count': 1,
            }
        cur.close()
        return result, None
    finally:
        conn.close()

# ============ 设备名册（wearable_device）======================
def device_register(device_sign, device_type=1, mac=None):
    """按 mac (优先) 或 device_sign UPSERT 到 wearable_device, 返回 (deviceId, action).

    5.06-v6 匹配优先级 (越靠前越权威):
        1. 有 mac -> 按 mac 查; 命中 -> 顺手把 sign 更新成最新 (sign 可能跨连接漂移, mac 不变)
        2. 无 mac 命中 -> 按 sign 查; 命中 -> 若客户端传了 mac 但表里这行还是 NULL 则补上
        3. 都没命中 -> INSERT 新行 (含 sign + mac)

    为什么 mac 匹配优于 sign: device_sign 是 'name_<MAC>' 复合, 同一手表 name 部分可能
    跨连接漂移 ('(上次连接)' 后缀, 系统名修改等), 导致同 mac 生成不同 sign 多行.
    现有数据中已发现 deviceId=4 与 deviceId=5 是同一张表 (用户报告).
    """
    if not device_sign:
        return None, '缺少 deviceSign'
    conn = get_connection()
    try:
        cur = conn.cursor()
        # 1. 优先按 mac 查
        if mac:
            cur.execute(
                'SELECT id, device_sign FROM wearable_device WHERE mac = %s LIMIT 1',
                (mac,)
            )
            row = cur.fetchone()
            if row:
                # 命中 mac, 顺手把 sign 更新成最新 (兼容 name 漂移)
                if row[1] != device_sign:
                    cur.execute(
                        'UPDATE wearable_device SET device_sign = %s WHERE id = %s',
                        (device_sign, row[0])
                    )
                    print('[设备注册] mac={} 命中已存在 id={}, sign 更新 {} -> {}'.format(
                        mac, row[0], row[1], device_sign))
                cur.close()
                return {'deviceId': row[0], 'action': 'matched-by-mac'}, None
        # 2. 按 sign 查
        cur.execute(
            'SELECT id, mac FROM wearable_device WHERE device_sign = %s LIMIT 1',
            (device_sign,)
        )
        row = cur.fetchone()
        if row:
            # 命中 sign, 若客户端传了 mac 但表里 mac 字段还空, 补上
            if mac and not row[1]:
                cur.execute(
                    'UPDATE wearable_device SET mac = %s WHERE id = %s',
                    (mac, row[0])
                )
                print('[设备注册] sign={} 命中已存在 id={}, 补充 mac={}'.format(
                    device_sign, row[0], mac))
            cur.close()
            return {'deviceId': row[0], 'action': 'matched-by-sign'}, None
        # 3. 都没命中 -> 新建
        cur.execute(
            'INSERT INTO wearable_device (device_sign, mac, type) VALUES (%s, %s, %s)',
            (device_sign, mac, device_type)
        )
        new_id = cur.lastrowid
        print('[设备注册] 新增 wearable_device: id={} sign={} mac={} type={}'.format(
            new_id, device_sign, mac, device_type))
        cur.close()
        return {'deviceId': new_id, 'action': 'created'}, None
    finally:
        conn.close()

def device_by_sign(sign):
    """按 sign 查 wearable_device，不创建"""
    if not sign:
        return None, '缺少 sign'
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            'SELECT id, device_sign, type FROM wearable_device WHERE device_sign = %s LIMIT 1',
            (sign,)
        )
        row = cur.fetchone()
        cur.close()
        if row:
            return {'id': row[0], 'device_sign': row[1], 'type': row[2]}, None
        return {'error': 'not found'}, None
    finally:
        conn.close()

def device_merge(from_id, to_id):
    """5.06-v6: 合并 wearable_device_data 两行的大 JSON: from_id -> to_id.

    每个中文键 (心率/血氧/血压/...) 的数组追加到 to_id, from_id 那行删除.
    wearable_device 表本身不动 (调用方再用 DELETE /api/device/<from_id> 清理).

    用途: iOS UUID 漂移生成的脏行合并. 例如生产数据 deviceId=5 与 deviceId=4 实际是同一手表,
    把 5 的所有数据合并到 4, 然后删掉 wearable_device.id=5 那行.
    """
    if not isinstance(from_id, int) or from_id <= 0:
        return None, 'invalid fromDeviceId'
    if not isinstance(to_id, int) or to_id <= 0:
        return None, 'invalid toDeviceId'
    if from_id == to_id:
        return None, 'fromDeviceId == toDeviceId'

    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute('SELECT id, data FROM wearable_device_data WHERE deviceId = %s LIMIT 1', (from_id,))
        from_row = cur.fetchone()
        if not from_row:
            cur.close()
            return None, 'fromDeviceId={} 在 wearable_device_data 中不存在'.format(from_id)
        cur.execute('SELECT id, data FROM wearable_device_data WHERE deviceId = %s LIMIT 1', (to_id,))
        to_row = cur.fetchone()

        try:
            from_json = json.loads(from_row[1]) if from_row[1] else {}
            if not isinstance(from_json, dict):
                from_json = {}
        except json.JSONDecodeError:
            from_json = {}
        if to_row:
            try:
                to_json = json.loads(to_row[1]) if to_row[1] else {}
                if not isinstance(to_json, dict):
                    to_json = {}
            except json.JSONDecodeError:
                to_json = {}
        else:
            to_json = {}

        merged_counts = {}
        for k, v in from_json.items():
            if not isinstance(v, list):
                continue
            if not isinstance(to_json.get(k), list):
                to_json[k] = []
            added = len(v)
            to_json[k].extend(v)
            merged_counts[k] = {'added': added, 'totalAfter': len(to_json[k])}

        merged_str = json.dumps(to_json, ensure_ascii=False)
        now_str = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        if to_row:
            cur.execute(
                'UPDATE wearable_device_data SET data = %s, createTime = %s WHERE id = %s',
                (merged_str, now_str, to_row[0])
            )
            to_row_id = to_row[0]
            to_action = 'updated'
        else:
            cur.execute(
                'INSERT INTO wearable_device_data (deviceId, data, createTime) VALUES (%s, %s, %s)',
                (to_id, merged_str, now_str)
            )
            to_row_id = cur.lastrowid
            to_action = 'inserted'

        cur.execute('DELETE FROM wearable_device_data WHERE id = %s', (from_row[0],))
        cur.close()
        print('[数据合并] from={} -> to={} | 类型 {} | 删 from 行 id={} | to 行 {} id={}'.format(
            from_id, to_id, list(merged_counts.keys()), from_row[0], to_action, to_row_id))
        return {
            'fromDeviceId': from_id,
            'toDeviceId': to_id,
            'mergedCounts': merged_counts,
            'fromRowDeleted': from_row[0],
            'toRowAction': to_action,
            'toRowId': to_row_id,
        }, None
    finally:
        conn.close()

def device_delete(device_id):
    """
    删 wearable_device 一行 + 联动删 wearable_device_data 中所有 deviceId 行.
    用于清理废弃设备 (例如 iOS UUID 飘逸生成的脏行).
    """
    if not isinstance(device_id, int) or device_id <= 0:
        return None, 'invalid id'
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute('DELETE FROM wearable_device_data WHERE deviceId = %s', (device_id,))
        deleted_data = cur.rowcount
        cur.execute('DELETE FROM wearable_device WHERE id = %s', (device_id,))
        deleted_device = cur.rowcount
        cur.close()
        print('[设备删除] id={} | wearable_device 删 {} 行 | wearable_device_data 删 {} 行'.format(
            device_id, deleted_device, deleted_data))
        return {'deviceId': device_id, 'deletedDevice': deleted_device, 'deletedData': deleted_data}, None
    finally:
        conn.close()

# ============ HTTP Handler ============
class HealthDataHandler(BaseHTTPRequestHandler):

    def _send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json(200, {'ok': True})

    def do_GET(self):
        parsed = urlparse(self.path)
        pathname = parsed.path
        query = parse_qs(parsed.query)

        if pathname == '/api/status':
            ok, info = test_db()
            self._send_json(200, {
                'status': 'running',
                'mysql': 'connected' if ok else 'disconnected',
                'total_devices': info if ok else 0,
                'error': None if ok else info,
                'server_time': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            })

        elif pathname == '/api/data':
            try:
                conn = get_connection()
                cur = conn.cursor()
                cur.execute('SELECT id, deviceId, data, createTime FROM wearable_device_data ORDER BY deviceId, createTime')
                rows = []
                for r in cur.fetchall():
                    big_json = json.loads(r[2]) if r[2] else {}
                    type_counts = {}
                    if isinstance(big_json, dict):
                        for k, v in big_json.items():
                            if isinstance(v, list):
                                type_counts[k] = len(v)
                    rows.append({
                        'id': r[0],
                        'deviceId': r[1],
                        'data': big_json,
                        'typeCounts': type_counts,
                        'createTime': r[3].strftime('%Y-%m-%d %H:%M:%S') if r[3] else None,
                    })
                cur.close()
                conn.close()
                self._send_json(200, {'count': len(rows), 'records': rows})
            except Exception as e:
                self._send_json(500, {'error': str(e)})

        elif pathname == '/api/device/by-sign':
            sign = (query.get('sign') or [None])[0]
            try:
                result, err = device_by_sign(sign)
                if err:
                    self._send_json(400, {'error': err})
                else:
                    self._send_json(200, result)
            except Exception as e:
                self._send_json(500, {'error': str(e)})

        else:
            self._send_json(200, {
                'service': '智能随访-可穿戴设备数据接收服务',
                'mode': '一台设备一行 + 大 JSON 汇总',
                'endpoints': {
                    'GET  /api/status': '服务状态',
                    'GET  /api/data': '查询所有设备',
                    'POST /api/health-data': 'UPSERT 体征数据',
                    'POST /api/device/register': '按 mac (优先) 或 device_sign UPSERT 到 wearable_device 并返回 deviceId',
                    'POST /api/device/merge': '合并 wearable_device_data 两行: {fromDeviceId, toDeviceId}',
                    'GET  /api/device/by-sign?sign=...': '按 sign 查 wearable_device（不创建）',
                    'DELETE /api/device/:id': '删 wearable_device 一行 + 联动删该 deviceId 的所有数据',
                },
            })

    def do_POST(self):
        parsed = urlparse(self.path)
        pathname = parsed.path

        try:
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length) if length > 0 else b'{}'
            body = json.loads(raw.decode('utf-8') or '{}')
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {'error': 'Invalid JSON'})
            return

        try:
            if pathname == '/api/health-data':
                device_id = body.get('deviceId', DEFAULT_DEVICE_ID)
                data_type = body.get('dataType')
                data = body.get('data')
                # 客户端 4.29-v5+ 携带的双时间戳:
                #   recordedAt = saveData 调用时刻 (= 用户在表上测量时刻, 经 BleHub 收到回包时填)
                #   uploadedAt = postOnce 发送时刻 (客户端) — 服务端记录自己收到的时刻更可靠
                # 缺省 (老客户端) 时用 server 当前时刻当采集时间, 兼容旧版本.
                recorded_at = body.get('recordedAt')
                # 服务端权威 uploadedAt: 用 server 收到时刻, 不信客户端的 (防时钟漂移)
                uploaded_at = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')
                if not data_type or data is None:
                    self._send_json(400, {
                        'error': 'Required fields: dataType, data',
                        'supportedTypes': list(TYPE_TO_CHINESE.keys()),
                    })
                    return
                result, err = upsert_device_data(device_id, data_type, data,
                                                  recorded_at=recorded_at,
                                                  uploaded_at=uploaded_at)
                if err:
                    self._send_json(400, {'error': err, 'supportedTypes': list(TYPE_TO_CHINESE.keys())})
                    return
                print('[{}] {} 设备{} {}({}条) 总{}类'.format(
                    datetime.datetime.now().strftime('%H:%M:%S'),
                    result['action'].upper(),
                    device_id,
                    result['type'],
                    result['count'],
                    result['totalTypes'],
                ))
                self._send_json(200, {'success': True, **result, 'deviceId': device_id})

            elif pathname == '/api/device/register':
                device_sign = body.get('deviceSign')
                device_type = body.get('type', 1)
                mac = body.get('mac')
                result, err = device_register(device_sign, device_type, mac=mac)
                if err:
                    self._send_json(400, {'error': err})
                else:
                    self._send_json(200, result)

            elif pathname == '/api/device/merge':
                from_id_raw = body.get('fromDeviceId')
                to_id_raw = body.get('toDeviceId')
                try:
                    from_id = int(from_id_raw) if from_id_raw is not None else None
                    to_id = int(to_id_raw) if to_id_raw is not None else None
                except (TypeError, ValueError):
                    self._send_json(400, {'error': 'fromDeviceId/toDeviceId 必须为正整数'})
                    return
                result, err = device_merge(from_id, to_id)
                if err:
                    self._send_json(400, {'error': err})
                else:
                    self._send_json(200, {'success': True, **result})

            else:
                self._send_json(404, {'error': 'Not found. Available: POST /api/health-data, POST /api/device/register, POST /api/device/merge'})

        except Exception as e:
            traceback.print_exc()
            self._send_json(500, {'error': str(e)})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        pathname = parsed.path
        # /api/device/:id
        m = re.match(r'^/api/device/(\d+)$', pathname)
        if not m:
            self._send_json(404, {'error': 'Not found. Available: DELETE /api/device/:id'})
            return
        try:
            device_id = int(m.group(1))
            result, err = device_delete(device_id)
            if err:
                self._send_json(400, {'error': err})
            else:
                self._send_json(200, {'success': True, **result})
        except Exception as e:
            traceback.print_exc()
            self._send_json(500, {'error': str(e)})

    def log_message(self, format, *args):
        pass

# ============ 启动 ============
if __name__ == '__main__':
    ok, info = test_db()
    if ok:
        print('[启动] MySQL 连接成功 → {}, 当前 {} 行体征数据'.format(DB_CONFIG['host'], info))
        # 5.06-v6: 启动时确保 mac 列存在 (idempotent), 后续 register 走 mac 优先匹配
        ensure_mac_column()
    else:
        print('[警告] MySQL 连接失败 → {}: {}'.format(DB_CONFIG['host'], info))

    server = HTTPServer(('0.0.0.0', PORT), HealthDataHandler)
    print('[启动] 智能随访数据接收服务: http://0.0.0.0:{}'.format(PORT))
    print('[模式] 一台设备一行 + 大 JSON 汇总（10 类体征 + 1 日综合）')
    print('[端点] POST /api/health-data       UPSERT 体征数据')
    print('[端点] POST /api/device/register   设备名册 UPSERT (mac 优先)')
    print('[端点] POST /api/device/merge      合并 wearable_device_data 两行')
    print('[端点] GET  /api/device/by-sign    设备名册查询')
    print('[端点] GET  /api/status            服务状态')
    print('[端点] GET  /api/data              查询所有设备')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[停止] 服务已关闭')
        server.server_close()
