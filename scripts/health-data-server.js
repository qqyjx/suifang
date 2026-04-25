/**
 * 健康数据 HTTP 同步服务器
 * 接收小程序采集的健康数据，保存到本地 JSON 文件并写入 MySQL 数据库
 * 同时提供 REST API 供外部客户查询数据
 *
 * 使用方法:
 * 1. 安装依赖: npm install (在 scripts 目录下)
 * 2. 启动 MySQL: echo "xyf" | sudo -S service mysql start
 * 3. 启动服务器: node health-data-server.js
 * 4. 服务器将在 http://localhost:3000 运行
 *
 * 注意: 在微信开发者工具中需要勾选"不校验合法域名"
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ============ 配置 ============
const PORT = 3000;
const DATA_DIR = path.join(__dirname, '..', 'health_data');

// MySQL 配置
const MYSQL_CONFIG = {
  socketPath: '/var/run/mysqld/mysqld.sock',
  user: 'root',
  password: 'health123',
  database: 'smart_followup_research',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
};

// 默认患者和设备 ID（小程序未传递时使用）
const DEFAULT_PATIENT_ID = 1;
const DEFAULT_DEVICE_ID = 1;

// ============ MySQL 连接池 ============
let pool = null;
let mysqlEnabled = false;

try {
  const mysql = require('mysql2/promise');
  pool = mysql.createPool(MYSQL_CONFIG);
  mysqlEnabled = true;
  console.log('[MySQL] mysql2 已加载，数据库写入已启用');
} catch (e) {
  console.warn('[MySQL] mysql2 未安装，仅使用 JSON 文件存储');
  console.warn('[MySQL] 安装命令: cd scripts && npm install mysql2');
}

// ============ 六元远程 MySQL 连接池 ============
let remotePool = null;
let remoteEnabled = false;
let remoteConfig = null;

try {
  const configPath = path.join(__dirname, 'remote-db-config.json');
  if (fs.existsSync(configPath)) {
    remoteConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (remoteConfig.enabled) {
      const mysql = require('mysql2/promise');
      remotePool = mysql.createPool({
        host: remoteConfig.host,
        port: remoteConfig.port,
        user: remoteConfig.user,
        password: remoteConfig.password,
        database: remoteConfig.database,
        waitForConnections: remoteConfig.waitForConnections,
        connectionLimit: remoteConfig.connectionLimit,
        charset: remoteConfig.charset,
        connectTimeout: remoteConfig.connectTimeout
      });
      remotePool.getConnection()
        .then(conn => { conn.release(); remoteEnabled = true; console.log('[六元MySQL] 连接成功 →', remoteConfig.host); })
        .catch(err => { console.warn('[六元MySQL] 连接失败(可能不在公司网络):', err.message); });
    }
  }
} catch (e) {
  console.warn('[六元MySQL] 配置加载失败，远程同步已禁用:', e.message);
}

// ============ 六元远程 MySQL 写入（一台设备一行 + 大JSON 汇总） ============

// 数据类型 → 中文键名映射（11 类，对应六元约定的中文字段）
const TYPE_TO_CHINESE = {
  heartRate:       '心率',
  bloodOxygen:     '血氧',
  bloodPressure:   '血压',
  temperature:     '体温',
  bloodGlucose:    '血糖',
  bloodLiquid:     '血液成分',
  bodyComposition: '身体成分',
  ecg:             '心电',
  step:            '步数',
  sleep:           '睡眠',
  daily:           '日综合'
};

// 血压风险分级（按 AHA 2017 标准）
function classifyBPRisk(systolic, diastolic) {
  if (systolic >= 180 || diastolic >= 120) return '危急';
  if (systolic >= 140 || diastolic >= 90)  return '高血压2级';
  if (systolic >= 130 || diastolic >= 80)  return '高血压1级';
  if (systolic >= 120 && diastolic < 80)   return '偏高';
  return '正常';
}

// 单条测量 → 中文字段记录（含采集时间）
function toChineseRecord(dataType, data) {
  let record = {};
  switch (dataType) {
    case 'heartRate':
      record = { '心率值': data.heartRate || 0, '心率状态': data.heartState || 0 };
      break;
    case 'bloodOxygen':
      record = { '血氧饱和度': data.bloodOxygen || 0, '心率': data.heartRate || 0 };
      break;
    case 'bloodPressure':
      record = {
        '高压': data.systolic || 0,
        '低压': data.diastolic || 0,
        '脉搏': data.heartRate || 0,
        '风险等级': classifyBPRisk(data.systolic || 0, data.diastolic || 0)
      };
      break;
    case 'temperature':
      record = { '体温': data.temperature || 0, '皮肤温度': data.skinTemperature || 0 };
      break;
    case 'bloodGlucose':
      record = { '血糖值_mmol_L': data.bloodGlucose || 0, '餐态': data.mealState || '' };
      break;
    case 'bloodLiquid':
      record = {
        '尿酸': data.uricAcid || 0,
        '胆固醇': data.cholesterol || 0,
        '甘油三酯': data.triacylglycerol || 0
      };
      break;
    case 'bodyComposition':
      record = {
        '体重': data.weight || 0,
        'BMI': data.bmi || 0,
        '体脂率': data.bodyFat || 0,
        '肌肉量': data.muscle || 0
      };
      break;
    case 'ecg':
      record = {
        '心率': data.heartRate || 0,
        '诊断': data.diseaseResult || '',
        '波形采样点数': Array.isArray(data.ecgWaveform) ? data.ecgWaveform.length : 0
      };
      break;
    case 'step':
      record = {
        '步数': data.step || 0,
        '卡路里': data.calorie || 0,
        '距离_米': data.distance || 0
      };
      break;
    case 'sleep':
      record = {
        '入睡时间': data.fallAsleepTime || '',
        '醒来时间': data.wakeUpTime || '',
        '深睡_分钟': data.deepSleepTime || 0,
        '浅睡_分钟': data.lightSleepTime || 0
      };
      break;
    case 'daily':
      record = { ...data };
      break;
    default:
      record = { ...data };
  }
  record['采集时间'] = new Date().toISOString();
  return record;
}

/**
 * UPSERT：一台设备一行，新数据 push 到大 JSON 对应类型数组
 * 流程：SELECT 现有行 → 解析大 JSON → push 新测量 → UPDATE 或 INSERT
 */
async function saveToRemoteMySQL(dataType, data, deviceId) {
  if (!remoteEnabled || !remotePool || !remoteConfig) return null;

  const chineseKey = TYPE_TO_CHINESE[dataType];
  if (!chineseKey) {
    console.warn(`[六元MySQL] 未知数据类型: ${dataType}`);
    return null;
  }

  const did = deviceId || DEFAULT_DEVICE_ID;
  const newRecord = toChineseRecord(dataType, data);
  const tableName = remoteConfig.dataTable;

  try {
    // 1. 查现有行
    const [rows] = await remotePool.execute(
      `SELECT id, data FROM \`${tableName}\` WHERE deviceId = ? LIMIT 1`,
      [did]
    );

    // 2. 解析或初始化大 JSON
    let bigJson = {};
    if (rows.length > 0 && rows[0].data) {
      try {
        bigJson = JSON.parse(rows[0].data);
      } catch (e) {
        console.warn(`[六元MySQL] 旧 data 列 JSON 解析失败，重新初始化:`, e.message);
        bigJson = {};
      }
    }

    // 3. 追加新测量到对应类型数组
    if (!Array.isArray(bigJson[chineseKey])) {
      bigJson[chineseKey] = [];
    }
    bigJson[chineseKey].push(newRecord);

    // 4. UPSERT
    const bigJsonStr = JSON.stringify(bigJson);
    if (rows.length > 0) {
      await remotePool.execute(
        `UPDATE \`${tableName}\` SET data = ?, createTime = NOW() WHERE id = ?`,
        [bigJsonStr, rows[0].id]
      );
      console.log(`[六元MySQL] ${dataType} → ${chineseKey} UPDATE 成功 (设备 ${did}, 该类共 ${bigJson[chineseKey].length} 条)`);
      return { deviceId: did, action: 'update', rowId: rows[0].id, type: chineseKey, count: bigJson[chineseKey].length };
    } else {
      const [result] = await remotePool.execute(
        `INSERT INTO \`${tableName}\` (deviceId, data, createTime) VALUES (?, ?, NOW())`,
        [did, bigJsonStr]
      );
      console.log(`[六元MySQL] ${dataType} → ${chineseKey} INSERT 成功 (设备 ${did}, 新行 id: ${result.insertId})`);
      return { deviceId: did, action: 'insert', rowId: result.insertId, type: chineseKey, count: 1 };
    }
  } catch (err) {
    console.error(`[六元MySQL] ${dataType} 写入失败:`, err.message);
    return null;
  }
}

// ============ 文件存储函数 ============

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getTodayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getCurrentTimestamp() {
  return new Date().toISOString();
}

function saveHealthDataToFile(dataType, data, date) {
  const dateDir = path.join(DATA_DIR, date);
  ensureDir(dateDir);

  const filePath = path.join(dateDir, `${dataType}.json`);

  let existingData = { date, records: [] };
  if (fs.existsSync(filePath)) {
    try {
      existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error(`[文件] 读取失败: ${filePath}`, e.message);
    }
  }

  const record = { timestamp: getCurrentTimestamp(), ...data };
  existingData.records.push(record);

  fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2), 'utf8');
  return { success: true, filePath, recordCount: existingData.records.length };
}

// ============ MySQL 写入函数 ============

const DATA_TYPE_MAP = {
  heartRate: { table: 'vital_heart_rate', type: 'direct' },
  bloodOxygen: { table: 'vital_blood_oxygen', type: 'direct' },
  bloodPressure: { table: 'vital_blood_pressure', type: 'direct' },
  temperature: { table: 'vital_signs', type: 'json', dbType: 'temperature' },
  bloodGlucose: { table: 'vital_signs', type: 'json', dbType: 'blood_glucose' },
  sleep: { table: 'vital_signs', type: 'json', dbType: 'sleep' },
  step: { table: 'vital_signs', type: 'json', dbType: 'step' },
  ecg: { table: 'vital_signs', type: 'json', dbType: 'ecg' },
  bloodLiquid: { table: 'vital_signs', type: 'json', dbType: 'blood_component' },
  bodyComposition: { table: 'vital_signs', type: 'json', dbType: 'body_composition' },
  daily: { table: 'vital_signs', type: 'json', dbType: 'daily' }
};

async function saveToMySQL(dataType, data, patientId, deviceId) {
  if (!mysqlEnabled || !pool) return null;

  const mapping = DATA_TYPE_MAP[dataType];
  if (!mapping) {
    console.warn(`[MySQL] 未知数据类型: ${dataType}`);
    return null;
  }

  const pid = patientId || DEFAULT_PATIENT_ID;
  const did = deviceId || DEFAULT_DEVICE_ID;
  const now = new Date();

  try {
    let result;

    if (mapping.type === 'direct') {
      if (dataType === 'heartRate') {
        const heartState = ['resting', 'active', 'sleeping', 'exercise'][data.heartState] || 'resting';
        [result] = await pool.execute(
          'INSERT INTO vital_heart_rate (patient_id, device_id, heart_rate, heart_state, recorded_at) VALUES (?, ?, ?, ?, ?)',
          [pid, did, data.heartRate || 0, heartState, now]
        );
      } else if (dataType === 'bloodOxygen') {
        [result] = await pool.execute(
          'INSERT INTO vital_blood_oxygen (patient_id, device_id, spo2, recorded_at) VALUES (?, ?, ?, ?)',
          [pid, did, data.bloodOxygen || 0, now]
        );
      } else if (dataType === 'bloodPressure') {
        const riskLevel = classifyBPRisk(data.systolic, data.diastolic);
        [result] = await pool.execute(
          'INSERT INTO vital_blood_pressure (patient_id, device_id, systolic, diastolic, pulse_rate, risk_level, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [pid, did, data.systolic || 0, data.diastolic || 0, data.heartRate || null, riskLevel, now]
        );
      }
    } else {
      [result] = await pool.execute(
        'INSERT INTO vital_signs (patient_id, device_id, data_type, vital_data, fhir_resource_type, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
        [pid, did, mapping.dbType, JSON.stringify(data), 'Observation', now]
      );
    }

    await pool.execute(
      'INSERT INTO data_sync_logs (patient_id, device_id, sync_channel, data_types, records_count, fhir_validated, json_schema_valid, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [pid, did, 'BLE_HTTPS', dataType, 1, 1, 1, 'success']
    );

    console.log(`[MySQL] ${dataType} → ${mapping.table} 写入成功 (id: ${result.insertId})`);
    return { insertId: result.insertId, table: mapping.table };
  } catch (err) {
    console.error(`[MySQL] ${dataType} 写入失败:`, err.message);
    try {
      await pool.execute(
        'INSERT INTO data_sync_logs (patient_id, device_id, sync_channel, data_types, records_count, fhir_validated, json_schema_valid, status, error_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [pid, did, 'BLE_HTTPS', dataType, 0, 0, 0, 'failed', err.message]
      );
    } catch (logErr) { /* ignore */ }
    return null;
  }
}

function classifyBPRisk(systolic, diastolic) {
  if (!systolic || !diastolic) return 'normal';
  if (systolic >= 180 || diastolic >= 120) return 'crisis';
  if (systolic >= 140 || diastolic >= 90) return 'hypertension_2';
  if (systolic >= 130 || diastolic >= 80) return 'hypertension_1';
  if (systolic >= 120 && diastolic < 80) return 'elevated';
  return 'normal';
}

// ============ 查询函数 ============

async function queryMySQL(sql, params = []) {
  if (!mysqlEnabled || !pool) {
    return { error: 'MySQL 未启用，请安装 mysql2: npm install mysql2', data: [] };
  }
  try {
    const [rows] = await pool.query(sql, params);
    return { data: rows };
  } catch (err) {
    return { error: err.message, data: [] };
  }
}

function buildTimeFilter(start, end) {
  const conditions = [];
  const params = [];
  if (start) { conditions.push('recorded_at >= ?'); params.push(start); }
  if (end) { conditions.push('recorded_at <= ?'); params.push(end); }
  return { conditions, params };
}

function getAllFileData() {
  const result = {};
  if (!fs.existsSync(DATA_DIR)) return result;
  const dates = fs.readdirSync(DATA_DIR).filter(f => fs.statSync(path.join(DATA_DIR, f)).isDirectory());
  for (const date of dates) {
    const dateDir = path.join(DATA_DIR, date);
    result[date] = {};
    for (const file of fs.readdirSync(dateDir).filter(f => f.endsWith('.json'))) {
      try { result[date][file.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(dateDir, file), 'utf8')); }
      catch (e) { /* skip */ }
    }
  }
  return result;
}

function getFileDataByDate(date) {
  const dateDir = path.join(DATA_DIR, date);
  const result = { date, data: {} };
  if (!fs.existsSync(dateDir)) return result;
  for (const file of fs.readdirSync(dateDir).filter(f => f.endsWith('.json'))) {
    try { result.data[file.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(dateDir, file), 'utf8')); }
    catch (e) { /* skip */ }
  }
  return result;
}

function clearAllFileData() {
  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
  ensureDir(DATA_DIR);
  return { success: true, message: '所有文件数据已清除' };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

// ============ HTTP 服务器 ============

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  console.log(`${new Date().toISOString()} ${req.method} ${pathname}`);

  try {
    // POST /api/health-data — 保存健康数据（小程序调用）
    if (req.method === 'POST' && pathname === '/api/health-data') {
      const body = await parseBody(req);
      const { dataType, data, date, patientId, deviceId } = body;
      if (!dataType || !data) { res.writeHead(400); res.end(JSON.stringify({ error: '缺少必要参数: dataType, data' })); return; }
      const fileResult = saveHealthDataToFile(dataType, data, date || getTodayDate());
      const mysqlResult = await saveToMySQL(dataType, data, patientId, deviceId);
      const remoteResult = await saveToRemoteMySQL(dataType, data, deviceId);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, file: fileResult, mysql: mysqlResult ? { insertId: mysqlResult.insertId, table: mysqlResult.table } : null, remote: remoteResult }));
      return;
    }

    // POST /api/device/register — 按 device_sign UPSERT 到六元 wearable_device，返回 deviceId
    // 小程序首次连上 BLE 后调用，把 `name_<MAC|UUID>` 上报，服务端确保有一行并回传 id。
    if (req.method === 'POST' && pathname === '/api/device/register') {
      const body = await parseBody(req);
      const { deviceSign, type } = body;
      if (!deviceSign) { res.writeHead(400); res.end(JSON.stringify({ error: '缺少 deviceSign' })); return; }
      if (!remoteEnabled || !remotePool) { res.writeHead(503); res.end(JSON.stringify({ error: '六元MySQL 未连接' })); return; }
      const [rows] = await remotePool.execute(
        'SELECT id FROM wearable_device WHERE device_sign = ? LIMIT 1', [deviceSign]
      );
      if (rows.length > 0) {
        res.writeHead(200); res.end(JSON.stringify({ deviceId: rows[0].id, action: 'existing' })); return;
      }
      const [r] = await remotePool.execute(
        'INSERT INTO wearable_device (device_sign, type) VALUES (?, ?)', [deviceSign, type || 1]
      );
      console.log(`[设备注册] 新增 wearable_device: id=${r.insertId} sign=${deviceSign} type=${type || 1}`);
      res.writeHead(200); res.end(JSON.stringify({ deviceId: r.insertId, action: 'created' }));
      return;
    }

    // GET /api/device/by-sign?sign=... — 只查不创建（运维核对用）
    if (req.method === 'GET' && pathname === '/api/device/by-sign') {
      const sign = url.searchParams.get('sign');
      if (!sign) { res.writeHead(400); res.end(JSON.stringify({ error: '缺少 sign' })); return; }
      if (!remoteEnabled || !remotePool) { res.writeHead(503); res.end(JSON.stringify({ error: '六元MySQL 未连接' })); return; }
      const [rows] = await remotePool.execute(
        'SELECT id, device_sign, type FROM wearable_device WHERE device_sign = ? LIMIT 1', [sign]
      );
      res.writeHead(200);
      res.end(JSON.stringify(rows.length > 0 ? rows[0] : { error: 'not found' }));
      return;
    }

    // GET /api/health-data — 获取文件数据
    if (req.method === 'GET' && pathname === '/api/health-data') {
      const date = url.searchParams.get('date');
      res.writeHead(200);
      res.end(JSON.stringify(date ? getFileDataByDate(date) : getAllFileData()));
      return;
    }

    // DELETE /api/health-data — 清除文件数据
    if (req.method === 'DELETE' && pathname === '/api/health-data') {
      res.writeHead(200); res.end(JSON.stringify(clearAllFileData())); return;
    }

    // GET /api/vitals/heart-rate
    if (req.method === 'GET' && pathname === '/api/vitals/heart-rate') {
      const patientId = url.searchParams.get('patient_id');
      const { start, end, limit } = getQueryParams(url);
      let sql = 'SELECT h.*, p.name AS patient_name FROM vital_heart_rate h JOIN patients p ON h.patient_id = p.id WHERE 1=1';
      const params = [];
      if (patientId) { sql += ' AND h.patient_id = ?'; params.push(patientId); }
      const tf = buildTimeFilter(start, end);
      tf.conditions.forEach(c => { sql += ` AND h.${c}`; }); params.push(...tf.params);
      sql += ' ORDER BY h.recorded_at DESC LIMIT ?'; params.push(limit);
      res.writeHead(200); res.end(JSON.stringify(await queryMySQL(sql, params))); return;
    }

    // GET /api/vitals/blood-oxygen
    if (req.method === 'GET' && pathname === '/api/vitals/blood-oxygen') {
      const patientId = url.searchParams.get('patient_id');
      const { start, end, limit } = getQueryParams(url);
      let sql = 'SELECT b.*, p.name AS patient_name FROM vital_blood_oxygen b JOIN patients p ON b.patient_id = p.id WHERE 1=1';
      const params = [];
      if (patientId) { sql += ' AND b.patient_id = ?'; params.push(patientId); }
      const tf = buildTimeFilter(start, end);
      tf.conditions.forEach(c => { sql += ` AND b.${c}`; }); params.push(...tf.params);
      sql += ' ORDER BY b.recorded_at DESC LIMIT ?'; params.push(limit);
      res.writeHead(200); res.end(JSON.stringify(await queryMySQL(sql, params))); return;
    }

    // GET /api/vitals/blood-pressure
    if (req.method === 'GET' && pathname === '/api/vitals/blood-pressure') {
      const patientId = url.searchParams.get('patient_id');
      const { start, end, limit } = getQueryParams(url);
      let sql = 'SELECT bp.*, p.name AS patient_name FROM vital_blood_pressure bp JOIN patients p ON bp.patient_id = p.id WHERE 1=1';
      const params = [];
      if (patientId) { sql += ' AND bp.patient_id = ?'; params.push(patientId); }
      const tf = buildTimeFilter(start, end);
      tf.conditions.forEach(c => { sql += ` AND bp.${c}`; }); params.push(...tf.params);
      sql += ' ORDER BY bp.recorded_at DESC LIMIT ?'; params.push(limit);
      res.writeHead(200); res.end(JSON.stringify(await queryMySQL(sql, params))); return;
    }

    // GET /api/vitals/signs
    if (req.method === 'GET' && pathname === '/api/vitals/signs') {
      const patientId = url.searchParams.get('patient_id');
      const dataType = url.searchParams.get('data_type');
      const { start, end, limit } = getQueryParams(url);
      let sql = 'SELECT v.*, p.name AS patient_name FROM vital_signs v JOIN patients p ON v.patient_id = p.id WHERE 1=1';
      const params = [];
      if (patientId) { sql += ' AND v.patient_id = ?'; params.push(patientId); }
      if (dataType) { sql += ' AND v.data_type = ?'; params.push(dataType); }
      const tf = buildTimeFilter(start, end);
      tf.conditions.forEach(c => { sql += ` AND v.${c}`; }); params.push(...tf.params);
      sql += ' ORDER BY v.recorded_at DESC LIMIT ?'; params.push(limit);
      res.writeHead(200); res.end(JSON.stringify(await queryMySQL(sql, params))); return;
    }

    // GET /api/vitals/reports
    if (req.method === 'GET' && pathname === '/api/vitals/reports') {
      const patientId = url.searchParams.get('patient_id');
      const reportType = url.searchParams.get('report_type');
      const limit = parseInt(url.searchParams.get('limit')) || 50;
      let sql = 'SELECT r.*, p.name AS patient_name FROM structured_reports r JOIN patients p ON r.patient_id = p.id WHERE 1=1';
      const params = [];
      if (patientId) { sql += ' AND r.patient_id = ?'; params.push(patientId); }
      if (reportType) { sql += ' AND r.report_type = ?'; params.push(reportType); }
      sql += ' ORDER BY r.generated_at DESC LIMIT ?'; params.push(limit);
      res.writeHead(200); res.end(JSON.stringify(await queryMySQL(sql, params))); return;
    }

    // GET /api/patients
    if (req.method === 'GET' && pathname === '/api/patients') {
      res.writeHead(200);
      res.end(JSON.stringify(await queryMySQL('SELECT p.*, c.cohort_name FROM patients p JOIN research_cohorts c ON p.cohort_id = c.id ORDER BY p.id')));
      return;
    }

    // GET /api/devices
    if (req.method === 'GET' && pathname === '/api/devices') {
      res.writeHead(200);
      res.end(JSON.stringify(await queryMySQL('SELECT d.*, p.name AS patient_name FROM medical_devices d LEFT JOIN patients p ON d.patient_id = p.id ORDER BY d.id')));
      return;
    }

    // GET /api/vitals/summary
    if (req.method === 'GET' && pathname === '/api/vitals/summary') {
      res.writeHead(200);
      res.end(JSON.stringify(await queryMySQL(`SELECT
        (SELECT COUNT(*) FROM vital_heart_rate) AS heart_rate_count,
        (SELECT COUNT(*) FROM vital_blood_oxygen) AS blood_oxygen_count,
        (SELECT COUNT(*) FROM vital_blood_pressure) AS blood_pressure_count,
        (SELECT COUNT(*) FROM vital_signs) AS vital_signs_count,
        (SELECT COUNT(*) FROM data_sync_logs) AS sync_logs_count,
        (SELECT COUNT(*) FROM structured_reports) AS reports_count,
        (SELECT COUNT(*) FROM patients) AS patients_count,
        (SELECT COUNT(*) FROM medical_devices) AS devices_count`)));
      return;
    }

    // GET /api/status
    if (req.method === 'GET' && pathname === '/api/status') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'running', timestamp: getCurrentTimestamp(), mysqlEnabled, remoteMySQL: { enabled: remoteEnabled, host: remoteConfig?.host || null, database: remoteConfig?.database || null }, dataDir: DATA_DIR }));
      return;
    }

    // GET /
    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(200);
      res.end(JSON.stringify({
        message: '智能随访系统 — 健康数据服务器',
        version: '2.0.0',
        mysqlEnabled,
        endpoints: {
          'POST /api/health-data': '保存健康数据（小程序调用）',
          'GET /api/health-data': '获取文件数据',
          'POST /api/device/register': '按 device_sign UPSERT 到 wearable_device 并返回 deviceId',
          'GET /api/device/by-sign': '按 sign 查 wearable_device（?sign=）',
          'GET /api/vitals/heart-rate': '心率 (?patient_id=&start=&end=&limit=)',
          'GET /api/vitals/blood-oxygen': '血氧',
          'GET /api/vitals/blood-pressure': '血压',
          'GET /api/vitals/signs': '综合体征 (?data_type=temperature|blood_glucose|sleep|step|ecg|...)',
          'GET /api/vitals/reports': '结构化报告',
          'GET /api/vitals/summary': '数据总量统计',
          'GET /api/patients': '受试者列表',
          'GET /api/devices': '设备列表',
          'GET /api/status': '服务器状态'
        }
      }));
      return;
    }

    res.writeHead(404); res.end(JSON.stringify({ error: 'Not Found' }));
  } catch (error) {
    console.error('请求处理错误:', error);
    res.writeHead(500); res.end(JSON.stringify({ error: error.message }));
  }
});

function getQueryParams(url) {
  return {
    start: url.searchParams.get('start'),
    end: url.searchParams.get('end'),
    limit: parseInt(url.searchParams.get('limit')) || 100
  };
}

ensureDir(DATA_DIR);

server.listen(PORT, () => {
  console.log('');
  console.log('='.repeat(60));
  console.log(' 智能随访系统 — 健康数据服务器 v2.0.0');
  console.log('='.repeat(60));
  console.log(`  地址: http://localhost:${PORT}`);
  console.log(`  本地MySQL: ${mysqlEnabled ? '✅ 已启用' : '❌ 未启用 (npm install mysql2)'}`);
  console.log(`  六元MySQL: ${remoteEnabled ? '✅ 已连接 → ' + remoteConfig.host : '⏳ 未连接(启动后异步检测)'}`);
  console.log('');
  console.log('  写入: POST /api/health-data → 本地JSON + 本地MySQL + 六元MySQL');
  console.log('  拉取: GET /api/vitals/{heart-rate|blood-oxygen|blood-pressure|signs|reports|summary}');
  console.log('  管理: GET /api/{patients|devices|status}');
  console.log('='.repeat(60));
});
