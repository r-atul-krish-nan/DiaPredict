package com.diapredict.android

data class SyncPayload(
    val cursor: String,
    val records: List<ApiHealthRecord>
)

data class ApiHealthRecord(
    val sourceRecordId: String,
    val metricType: String,
    val startTime: String,
    val endTime: String,
    val value: Double,
    val unit: String,
    val sourceApp: String,
    val sourceDevice: String,
    val metadata: Map<String, String> = emptyMap()
)

data class MetricSnapshot(
    val metricType: String,
    val label: String,
    val value: String,
    val unit: String,
    val measuredAt: String,
    val sourceDevice: String,
    val samples: Int
)

data class SyncResultState(
    val status: String,
    val message: String,
    val uploadedCount: Int = 0,
    val metrics: List<MetricSnapshot> = emptyList()
)
