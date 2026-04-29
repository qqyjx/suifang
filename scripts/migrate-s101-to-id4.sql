-- 智能随访 - 重排 wearable_device id, 让 S101 拿到顺序的 id=4
--
-- 背景:
--   1/2/3 是六元 init.sql 灌的 3 个虚拟病人 (种子数据, 保留)
--   S101 在 v2 修复前因 iOS UUID 飘逸 register 多次, 现在 id=6
--   4/5 之前被人工删除过 (AUTO_INCREMENT 不回退, 所以新设备从 max+1 开始)
--   7~13 是六元那边的其他测试残留 (sign 不知道, 与 S101 无关)
--
-- 目标: S101 (sign='S101_FA:BA:94:8A:70:75') = id=4
--
-- 操作步骤:
--   1. 删除 id > 3 的所有 wearable_device 行 + 关联 wearable_device_data
--   2. ALTER TABLE wearable_device AUTO_INCREMENT = 4
--   3. 客户端再次 register S101 sign → 自动拿到 id=4
--
-- !! 警告 !! 这会清掉:
--   * S101 当前 (id=6) 在 wearable_device_data 里的所有历史数据 (12 条日综合 + 60 条步数)
--   * 其他 7~13 测试 device 的所有数据 (六元那边自测的)
-- 如果你想保留 S101 的历史数据, 先备份再做 (步骤见末尾).

USE h6dp_suifang;

-- ==== 0. 操作前看现状 (不修改) ====
SELECT '=== 操作前: wearable_device ===' AS info;
SELECT id, device_sign, type FROM wearable_device ORDER BY id;
SELECT '=== 操作前: wearable_device_data ===' AS info;
SELECT id, deviceId, createTime FROM wearable_device_data ORDER BY deviceId, id;

-- ==== 1. 清掉 id > 3 的所有 device 行 + 关联数据 ====
DELETE FROM wearable_device_data WHERE deviceId > 3;
DELETE FROM wearable_device WHERE id > 3;

-- ==== 2. 重置 AUTO_INCREMENT 到 4 ====
ALTER TABLE wearable_device AUTO_INCREMENT = 4;

-- ==== 3. 验证 ====
SELECT '=== 操作后: wearable_device ===' AS info;
SELECT id, device_sign, type FROM wearable_device ORDER BY id;
SELECT '=== 操作后: AUTO_INCREMENT 应该是 4 ===' AS info;
SHOW TABLE STATUS WHERE Name = 'wearable_device';

-- ==== 4. 完成后做什么 ====
-- 在小程序上 4.29-v5 重新连接 S101 (设备扫描 → 选 S101)
-- 客户端会调 POST /api/device/register, 服务端 SELECT 不到 sign='S101_FA:BA:94:8A:70:75'
-- → INSERT 新行, 拿到 id=4 (因为 AUTO_INCREMENT=4)
-- → 验证: SELECT * FROM wearable_device WHERE device_sign LIKE 'S101%';

-- ==== 备份选项 (操作前若想保数据) ====
-- CREATE TABLE wearable_device_BAK_20260429 AS SELECT * FROM wearable_device;
-- CREATE TABLE wearable_device_data_BAK_20260429 AS SELECT * FROM wearable_device_data;
