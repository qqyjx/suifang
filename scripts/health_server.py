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
- POST /api/device/register              按 device_sign UPSERT 到 wearable_device，返回 deviceId
- GET  /api/device/by-sign?sign=...      按 sign 查 wearable_device（不创建）

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

# ============ 数据转换 ============
def classify_bp(systolic, diastolic):
    """血压风险分级（AHA 2017 标准）"""
    s, d = systolic or 0, diastolic or 0
    if s >= 180 or d >= 120: return '危急'
    if s >= 140 or d >= 90:  return '高血压2级'
    if s >= 130 or d >= 80:  return '高血压1级'
    if s >= 120 and d < 80:  return '偏高'
    return '正常'

def to_chinese_record(data_type, data):
    """单条测量 → 中文字段记录（含采集时间）"""
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
    record['采集时间'] = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')
    return record

# ============ UPSERT 大 JSON 逻辑 ============
def upsert_device_data(device_id, data_type, data):
    """一台设备一行：SELECT-merge-UPSERT"""
    chinese_key = TYPE_TO_CHINESE.get(data_type)
    if not chinese_key:
        return None, '未知数据类型: {}'.format(data_type)

    new_record = to_chinese_record(data_type, data)
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
def device_register(device_sign, device_type=1):
    """按 device_sign UPSERT 到 wearable_device，返回 (deviceId, action)"""
    if not device_sign:
        return None, '缺少 deviceSign'
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            'SELECT id FROM wearable_device WHERE device_sign = %s LIMIT 1',
            (device_sign,)
        )
        row = cur.fetchone()
        if row:
            cur.close()
            return {'deviceId': row[0], 'action': 'existing'}, None
        cur.execute(
            'INSERT INTO wearable_device (device_sign, type) VALUES (%s, %s)',
            (device_sign, device_type)
        )
        new_id = cur.lastrowid
        print('[设备注册] 新增 wearable_device: id={} sign={} type={}'.format(new_id, device_sign, device_type))
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
                    'POST /api/device/register': '按 device_sign UPSERT 到 wearable_device 并返回 deviceId',
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
                if not data_type or data is None:
                    self._send_json(400, {
                        'error': 'Required fields: dataType, data',
                        'supportedTypes': list(TYPE_TO_CHINESE.keys()),
                    })
                    return
                result, err = upsert_device_data(device_id, data_type, data)
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
                result, err = device_register(device_sign, device_type)
                if err:
                    self._send_json(400, {'error': err})
                else:
                    self._send_json(200, result)

            else:
                self._send_json(404, {'error': 'Not found. Available: POST /api/health-data, POST /api/device/register'})

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
    else:
        print('[警告] MySQL 连接失败 → {}: {}'.format(DB_CONFIG['host'], info))

    server = HTTPServer(('0.0.0.0', PORT), HealthDataHandler)
    print('[启动] 智能随访数据接收服务: http://0.0.0.0:{}'.format(PORT))
    print('[模式] 一台设备一行 + 大 JSON 汇总（10 类体征 + 1 日综合）')
    print('[端点] POST /api/health-data       UPSERT 体征数据')
    print('[端点] POST /api/device/register   设备名册 UPSERT')
    print('[端点] GET  /api/device/by-sign    设备名册查询')
    print('[端点] GET  /api/status            服务状态')
    print('[端点] GET  /api/data              查询所有设备')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[停止] 服务已关闭')
        server.server_close()
