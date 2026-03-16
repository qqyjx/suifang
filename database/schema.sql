mysqldump: [Warning] Using a password on the command line interface can be insecure.
-- MySQL dump 10.13  Distrib 8.0.45, for Linux (x86_64)
--
-- Host: localhost    Database: smart_followup_research
-- ------------------------------------------------------
-- Server version	8.0.45-0ubuntu0.22.04.1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `data_sync_logs`
--

DROP TABLE IF EXISTS `data_sync_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `data_sync_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `patient_id` int NOT NULL,
  `device_id` int NOT NULL,
  `sync_channel` enum('BLE_HTTPS','BLE_MQTT','MANUAL_OCR') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '同步通道',
  `data_types` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '同步的数据类型',
  `records_count` int NOT NULL COMMENT '同步记录数',
  `fhir_validated` tinyint(1) DEFAULT '1' COMMENT 'FHIR结构化校验通过',
  `json_schema_valid` tinyint(1) DEFAULT '1' COMMENT 'JSON Schema校验通过',
  `status` enum('success','partial','failed') COLLATE utf8mb4_unicode_ci DEFAULT 'success',
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `synced_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `patient_id` (`patient_id`),
  KEY `device_id` (`device_id`),
  CONSTRAINT `data_sync_logs_ibfk_1` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`),
  CONSTRAINT `data_sync_logs_ibfk_2` FOREIGN KEY (`device_id`) REFERENCES `medical_devices` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=141 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='数据同步与结构化校验日志';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `medical_devices`
--

DROP TABLE IF EXISTS `medical_devices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `medical_devices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '设备名称',
  `model` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '设备型号',
  `device_type` enum('wrist','head','chest','finger') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '佩戴类型',
  `manufacturer` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '生产厂商',
  `registration_cert_no` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '二类医疗器械注册证编号',
  `mac_address` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'BLE MAC地址',
  `patient_id` int DEFAULT NULL COMMENT '绑定患者',
  `firmware_version` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '固件版本',
  `bind_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `patient_id` (`patient_id`),
  CONSTRAINT `medical_devices_ibfk_1` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='二类医疗器械设备清单';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `patients`
--

DROP TABLE IF EXISTS `patients`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `patients` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cohort_id` int NOT NULL COMMENT '所属队列',
  `patient_no` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '受试者编号',
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '姓名',
  `gender` enum('M','F') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '性别',
  `age` int NOT NULL COMMENT '年龄',
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系电话',
  `diagnosis` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '主要诊断',
  `enrolled_at` date DEFAULT NULL COMMENT '入组日期',
  `status` enum('active','withdrawn','completed') COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `patient_no` (`patient_no`),
  KEY `cohort_id` (`cohort_id`),
  CONSTRAINT `patients_ibfk_1` FOREIGN KEY (`cohort_id`) REFERENCES `research_cohorts` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='受试者信息';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `research_cohorts`
--

DROP TABLE IF EXISTS `research_cohorts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `research_cohorts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cohort_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '队列名称',
  `research_purpose` text COLLATE utf8mb4_unicode_ci COMMENT '研究目的',
  `principal_investigator` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '负责人',
  `start_date` date DEFAULT NULL COMMENT '启动日期',
  `status` enum('recruiting','active','completed','suspended') COLLATE utf8mb4_unicode_ci DEFAULT 'active' COMMENT '队列状态',
  `target_size` int DEFAULT NULL COMMENT '目标样本量',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='研究队列';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `structured_reports`
--

DROP TABLE IF EXISTS `structured_reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `structured_reports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `patient_id` int NOT NULL,
  `report_type` enum('daily','weekly','monthly','alert') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '报告类型',
  `report_period_start` date DEFAULT NULL COMMENT '报告周期起始',
  `report_period_end` date DEFAULT NULL COMMENT '报告周期结束',
  `data_summary` json NOT NULL COMMENT '结构化摘要数据',
  `fhir_resource_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'DiagnosticReport' COMMENT 'FHIR资源类型',
  `risk_flags` json DEFAULT NULL COMMENT '风险标记',
  `generated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `patient_id` (`patient_id`),
  CONSTRAINT `structured_reports_ibfk_1` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=81 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='结构化分析报告(FHIR DiagnosticReport)';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `vital_blood_oxygen`
--

DROP TABLE IF EXISTS `vital_blood_oxygen`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vital_blood_oxygen` (
  `id` int NOT NULL AUTO_INCREMENT,
  `patient_id` int NOT NULL,
  `device_id` int NOT NULL,
  `spo2` decimal(4,1) NOT NULL COMMENT '血氧饱和度(%)',
  `recorded_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `device_id` (`device_id`),
  KEY `idx_patient_time` (`patient_id`,`recorded_at`),
  CONSTRAINT `vital_blood_oxygen_ibfk_1` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`),
  CONSTRAINT `vital_blood_oxygen_ibfk_2` FOREIGN KEY (`device_id`) REFERENCES `medical_devices` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=841 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='血氧监测数据';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `vital_blood_pressure`
--

DROP TABLE IF EXISTS `vital_blood_pressure`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vital_blood_pressure` (
  `id` int NOT NULL AUTO_INCREMENT,
  `patient_id` int NOT NULL,
  `device_id` int NOT NULL,
  `systolic` int NOT NULL COMMENT '收缩压(mmHg)',
  `diastolic` int NOT NULL COMMENT '舒张压(mmHg)',
  `pulse_rate` int DEFAULT NULL COMMENT '脉率',
  `risk_level` enum('normal','elevated','hypertension_1','hypertension_2','crisis') COLLATE utf8mb4_unicode_ci DEFAULT 'normal' COMMENT '风险等级',
  `recorded_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `device_id` (`device_id`),
  KEY `idx_patient_time` (`patient_id`,`recorded_at`),
  CONSTRAINT `vital_blood_pressure_ibfk_1` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`),
  CONSTRAINT `vital_blood_pressure_ibfk_2` FOREIGN KEY (`device_id`) REFERENCES `medical_devices` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=211 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='血压监测数据';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `vital_heart_rate`
--

DROP TABLE IF EXISTS `vital_heart_rate`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vital_heart_rate` (
  `id` int NOT NULL AUTO_INCREMENT,
  `patient_id` int NOT NULL,
  `device_id` int NOT NULL,
  `heart_rate` int NOT NULL COMMENT '心率(bpm)',
  `heart_state` enum('resting','active','sleeping','exercise') COLLATE utf8mb4_unicode_ci DEFAULT 'resting' COMMENT '状态',
  `recorded_at` datetime NOT NULL COMMENT '采集时间',
  PRIMARY KEY (`id`),
  KEY `device_id` (`device_id`),
  KEY `idx_patient_time` (`patient_id`,`recorded_at`),
  CONSTRAINT `vital_heart_rate_ibfk_1` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`),
  CONSTRAINT `vital_heart_rate_ibfk_2` FOREIGN KEY (`device_id`) REFERENCES `medical_devices` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1681 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='心率监测数据';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `vital_signs`
--

DROP TABLE IF EXISTS `vital_signs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vital_signs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `patient_id` int NOT NULL,
  `device_id` int NOT NULL,
  `data_type` enum('temperature','blood_glucose','sleep','step','ecg','blood_component','body_composition','daily') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '数据类型',
  `vital_data` json NOT NULL COMMENT '结构化体征数据(JSON Schema校验)',
  `fhir_resource_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'FHIR资源类型映射',
  `recorded_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `device_id` (`device_id`),
  KEY `idx_patient_type_time` (`patient_id`,`data_type`,`recorded_at`),
  CONSTRAINT `vital_signs_ibfk_1` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`),
  CONSTRAINT `vital_signs_ibfk_2` FOREIGN KEY (`device_id`) REFERENCES `medical_devices` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=446 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='综合体征数据(JSON Schema结构化)';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-03-14 16:31:59
