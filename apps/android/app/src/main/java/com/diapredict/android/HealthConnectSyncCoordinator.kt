package com.diapredict.android

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.permission.HealthPermission.Companion.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BasalMetabolicRateRecord
import androidx.health.connect.client.records.BloodGlucoseRecord
import androidx.health.connect.client.records.BloodPressureRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeightRecord
import androidx.health.connect.client.records.HydrationRecord
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.PowerRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.SpeedRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.Vo2MaxRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Duration
import java.time.Instant
import java.util.Locale
import kotlin.math.roundToInt
import kotlin.reflect.KClass

class HealthConnectSyncCoordinator(private val context: Context) {
    private val stepsPermission = HealthPermission.getReadPermission(StepsRecord::class)
    private val heartRatePermission = HealthPermission.getReadPermission(HeartRateRecord::class)
    private val sleepPermission = HealthPermission.getReadPermission(SleepSessionRecord::class)
    private val glucosePermission = HealthPermission.getReadPermission(BloodGlucoseRecord::class)
    private val bloodPressurePermission = HealthPermission.getReadPermission(BloodPressureRecord::class)
    private val weightPermission = HealthPermission.getReadPermission(WeightRecord::class)
    private val bodyFatPermission = HealthPermission.getReadPermission(BodyFatRecord::class)
    private val heightPermission = HealthPermission.getReadPermission(HeightRecord::class)
    private val oxygenPermission = HealthPermission.getReadPermission(OxygenSaturationRecord::class)
    private val hydrationPermission = HealthPermission.getReadPermission(HydrationRecord::class)
    private val exercisePermission = HealthPermission.getReadPermission(ExerciseSessionRecord::class)
    private val activeCaloriesPermission = HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class)
    private val totalCaloriesPermission = HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class)
    private val distancePermission = HealthPermission.getReadPermission(DistanceRecord::class)
    private val powerPermission = HealthPermission.getReadPermission(PowerRecord::class)
    private val speedPermission = HealthPermission.getReadPermission(SpeedRecord::class)
    private val vo2MaxPermission = HealthPermission.getReadPermission(Vo2MaxRecord::class)
    private val bmrPermission = HealthPermission.getReadPermission(BasalMetabolicRateRecord::class)
    private val nutritionPermission = HealthPermission.getReadPermission(NutritionRecord::class)

    val requestedPermissions: Set<String> = setOf(
        stepsPermission,
        heartRatePermission,
        sleepPermission,
        glucosePermission,
        bloodPressurePermission,
        weightPermission,
        bodyFatPermission,
        heightPermission,
        oxygenPermission,
        hydrationPermission,
        exercisePermission,
        activeCaloriesPermission,
        totalCaloriesPermission,
        distancePermission,
        powerPermission,
        speedPermission,
        vo2MaxPermission,
        bmrPermission,
        nutritionPermission
    )

    private val apiClient = ApiClient()

    fun sdkStatus(): Int = HealthConnectClient.getSdkStatus(context)

    suspend fun canBackgroundRead(): Boolean = withContext(Dispatchers.IO) {
        val status = sdkStatus()
        if (status != HealthConnectClient.SDK_AVAILABLE) {
            return@withContext false
        }

        val client = HealthConnectClient.getOrCreate(context)
        client.features.getFeatureStatus(
            HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND
        ) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
    }

    suspend fun getGrantedPermissions(): Set<String> = withContext(Dispatchers.IO) {
        if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
            return@withContext emptySet()
        }

        HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions()
    }

    suspend fun hasBackgroundPermission(): Boolean = withContext(Dispatchers.IO) {
        if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
            return@withContext false
        }

        PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND in HealthConnectClient
            .getOrCreate(context)
            .permissionController
            .getGrantedPermissions()
    }

    suspend fun previewLast24Hours(): List<MetricSnapshot> = withContext(Dispatchers.IO) {
        val status = sdkStatus()
        if (status != HealthConnectClient.SDK_AVAILABLE) {
            return@withContext emptyList()
        }

        val client = HealthConnectClient.getOrCreate(context)
        val granted = client.permissionController.getGrantedPermissions()
        if (granted.intersect(requestedPermissions).isEmpty()) {
            return@withContext emptyList()
        }

        return@withContext summarizeMetrics(readAllRecords(client, granted))
    }

    suspend fun syncLast24Hours(): SyncResultState = withContext(Dispatchers.IO) {
        val status = sdkStatus()
        if (status != HealthConnectClient.SDK_AVAILABLE) {
            return@withContext SyncResultState(
                status = "unavailable",
                message = "Health Connect is unavailable or needs an update."
            )
        }

        val client = HealthConnectClient.getOrCreate(context)
        val granted = client.permissionController.getGrantedPermissions()
        val readablePermissions = granted.intersect(requestedPermissions)

        if (readablePermissions.isEmpty()) {
            return@withContext SyncResultState(
                status = "permissions_required",
                message = "Grant at least one Health Connect metric permission before syncing."
            )
        }

        val payloadRecords = readAllRecords(client, readablePermissions)
        val metricSnapshots = summarizeMetrics(payloadRecords)

        if (payloadRecords.isEmpty()) {
            return@withContext SyncResultState(
                status = "success",
                message = "Permissions are granted, but no matching records were found in the last 30 days.",
                uploadedCount = 0,
                metrics = metricSnapshots
            )
        }

        val uploadResult = apiClient.uploadBatch(
            SyncPayload(
                cursor = "window-${Instant.now().toEpochMilli()}",
                records = payloadRecords
            )
        )

        uploadResult.copy(
            uploadedCount = payloadRecords.size,
            metrics = metricSnapshots
        )
    }

    private suspend fun readAllRecords(client: HealthConnectClient, grantedPermissions: Set<String>): MutableList<ApiHealthRecord> {
        val now = Instant.now()
        val start = now.minus(Duration.ofDays(30))
        val payloadRecords = mutableListOf<ApiHealthRecord>()

        if (stepsPermission in grantedPermissions) payloadRecords += safeMetricRead { readSteps(client, start, now) }
        if (heartRatePermission in grantedPermissions) payloadRecords += safeMetricRead { readHeartRate(client, start, now) }
        if (sleepPermission in grantedPermissions) payloadRecords += safeMetricRead { readSleep(client, start, now) }
        if (glucosePermission in grantedPermissions) payloadRecords += safeMetricRead { readBloodGlucose(client, start, now) }
        if (bloodPressurePermission in grantedPermissions) payloadRecords += safeMetricRead { readBloodPressure(client, start, now) }
        if (weightPermission in grantedPermissions) payloadRecords += safeMetricRead { readWeight(client, start, now) }
        if (bodyFatPermission in grantedPermissions) payloadRecords += safeMetricRead { readBodyFat(client, start, now) }
        if (heightPermission in grantedPermissions) payloadRecords += safeMetricRead { readHeight(client, start, now) }
        if (oxygenPermission in grantedPermissions) payloadRecords += safeMetricRead { readOxygenSaturation(client, start, now) }
        if (hydrationPermission in grantedPermissions) payloadRecords += safeMetricRead { readHydration(client, start, now) }
        if (exercisePermission in grantedPermissions) payloadRecords += safeMetricRead { readExercise(client, start, now) }
        if (activeCaloriesPermission in grantedPermissions) payloadRecords += safeMetricRead { readActiveCalories(client, start, now) }
        if (totalCaloriesPermission in grantedPermissions) payloadRecords += safeMetricRead { readTotalCalories(client, start, now) }
        if (distancePermission in grantedPermissions) payloadRecords += safeMetricRead { readDistance(client, start, now) }
        if (powerPermission in grantedPermissions) payloadRecords += safeMetricRead { readPower(client, start, now) }
        if (speedPermission in grantedPermissions) payloadRecords += safeMetricRead { readSpeed(client, start, now) }
        if (vo2MaxPermission in grantedPermissions) payloadRecords += safeMetricRead { readVo2Max(client, start, now) }
        if (bmrPermission in grantedPermissions) payloadRecords += safeMetricRead { readBasalMetabolicRate(client, start, now) }
        if (nutritionPermission in grantedPermissions) payloadRecords += safeMetricRead { readNutrition(client, start, now) }

        return payloadRecords
    }

    private suspend fun readSteps(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, StepsRecord::class, start, end)
        return response.map { record ->
            toApiRecord(record.metadata, "steps", record.startTime.toString(), record.endTime.toString(), record.count.toDouble(), "count")
        }
    }

    private suspend fun readHeartRate(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, HeartRateRecord::class, start, end)
        return response.mapNotNull { record ->
            val average = record.samples.map { it.beatsPerMinute }.average()
            if (average.isNaN()) null else toApiRecord(record.metadata, "heart_rate", record.startTime.toString(), record.endTime.toString(), average, "bpm")
        }
    }

    private suspend fun readSleep(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, SleepSessionRecord::class, start, end)
        return response.map { record ->
            val hours = Duration.between(record.startTime, record.endTime).toMinutes() / 60.0
            toApiRecord(
                metadata = record.metadata,
                metricType = "sleep",
                startTime = record.startTime.toString(),
                endTime = record.endTime.toString(),
                value = hours,
                unit = "hours",
                metadataExtras = mapOf(
                    "title" to (record.title ?: "Sleep"),
                    "stages" to record.stages.size.toString()
                )
            )
        }
    }

    private suspend fun readBloodGlucose(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, BloodGlucoseRecord::class, start, end)
        return response.map { record ->
            toApiRecord(record.metadata, "blood_glucose", record.time.toString(), record.time.toString(), record.level.inMilligramsPerDeciliter, "mg/dL")
        }
    }

    private suspend fun readBloodPressure(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, BloodPressureRecord::class, start, end)
        return response.flatMap { record ->
            listOf(
                toApiRecord(record.metadata, "blood_pressure_systolic", record.time.toString(), record.time.toString(), record.systolic.inMillimetersOfMercury, "mmHg"),
                toApiRecord(record.metadata, "blood_pressure_diastolic", record.time.toString(), record.time.toString(), record.diastolic.inMillimetersOfMercury, "mmHg")
            )
        }
    }

    private suspend fun readWeight(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, WeightRecord::class, start, end)
        return response.map { record ->
            toApiRecord(record.metadata, "weight", record.time.toString(), record.time.toString(), record.weight.inKilograms, "kg")
        }
    }

    private suspend fun readBodyFat(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, BodyFatRecord::class, start, end)
        return response.map { record ->
            toApiRecord(record.metadata, "body_fat", record.time.toString(), record.time.toString(), record.percentage.value, "%")
        }
    }

    private suspend fun readHeight(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, HeightRecord::class, start, end)
        return response.map { record ->
            toApiRecord(record.metadata, "height", record.time.toString(), record.time.toString(), record.height.inMeters, "m")
        }
    }

    private suspend fun readOxygenSaturation(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, OxygenSaturationRecord::class, start, end)
        return response.map { record ->
            toApiRecord(record.metadata, "oxygen_saturation", record.time.toString(), record.time.toString(), record.percentage.value, "%")
        }
    }

    private suspend fun readHydration(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, HydrationRecord::class, start, end)
        return response.map { record ->
            toApiRecord(record.metadata, "hydration", record.startTime.toString(), record.endTime.toString(), record.volume.inLiters, "L")
        }
    }

    private suspend fun readExercise(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, ExerciseSessionRecord::class, start, end)
        return response.map { record ->
            val durationMinutes = Duration.between(record.startTime, record.endTime).toMinutes().toDouble()
            toApiRecord(
                metadata = record.metadata,
                metricType = "exercise",
                startTime = record.startTime.toString(),
                endTime = record.endTime.toString(),
                value = durationMinutes,
                unit = "minutes",
                metadataExtras = mapOf(
                    "exerciseType" to record.exerciseType.toString(),
                    "title" to (record.title ?: "Workout")
                )
            )
        }
    }

    private suspend fun readActiveCalories(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, ActiveCaloriesBurnedRecord::class, start, end)
        return response.map { record ->
            toApiRecord(record.metadata, "active_calories_burned", record.startTime.toString(), record.endTime.toString(), record.energy.inKilocalories, "kcal")
        }
    }

    private suspend fun readTotalCalories(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, TotalCaloriesBurnedRecord::class, start, end)
        return response.map { record ->
            toApiRecord(record.metadata, "total_calories_burned", record.startTime.toString(), record.endTime.toString(), record.energy.inKilocalories, "kcal")
        }
    }

    private suspend fun readDistance(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, DistanceRecord::class, start, end)
        return response.map { record ->
            toApiRecord(record.metadata, "distance", record.startTime.toString(), record.endTime.toString(), record.distance.inMeters, "m")
        }
    }

    private suspend fun readPower(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, PowerRecord::class, start, end)
        return response.mapNotNull { record ->
            val average = record.samples.map { it.power.inWatts }.average()
            if (average.isNaN()) null else toApiRecord(record.metadata, "power", record.startTime.toString(), record.endTime.toString(), average, "W")
        }
    }

    private suspend fun readSpeed(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, SpeedRecord::class, start, end)
        return response.mapNotNull { record ->
            val average = record.samples.map { it.speed.inMetersPerSecond }.average()
            if (average.isNaN()) null else toApiRecord(record.metadata, "speed", record.startTime.toString(), record.endTime.toString(), average, "m/s")
        }
    }

    private suspend fun readVo2Max(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, Vo2MaxRecord::class, start, end)
        return response.map { record ->
            toApiRecord(record.metadata, "vo2_max", record.time.toString(), record.time.toString(), record.vo2MillilitersPerMinuteKilogram, "mL/kg/min")
        }
    }

    private suspend fun readBasalMetabolicRate(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, BasalMetabolicRateRecord::class, start, end)
        return response.map { record ->
            toApiRecord(record.metadata, "basal_metabolic_rate", record.time.toString(), record.time.toString(), record.basalMetabolicRate.inKilocaloriesPerDay, "kcal/day")
        }
    }

    private suspend fun readNutrition(client: HealthConnectClient, start: Instant, end: Instant): List<ApiHealthRecord> {
        val response = readRecords(client, NutritionRecord::class, start, end)
        return response.mapNotNull { record ->
            val energy = record.energy ?: return@mapNotNull null
            toApiRecord(
                metadata = record.metadata,
                metricType = "nutrition_energy",
                startTime = record.startTime.toString(),
                endTime = record.endTime.toString(),
                value = energy.inKilocalories,
                unit = "kcal",
                metadataExtras = mapOf(
                    "name" to (record.name ?: "Meal"),
                    "mealType" to record.mealType.toString()
                )
            )
        }
    }

    private suspend fun <T> safeMetricRead(block: suspend () -> List<T>): List<T> {
        return try {
            block()
        } catch (_: IllegalArgumentException) {
            emptyList()
        } catch (_: SecurityException) {
            emptyList()
        }
    }

    private suspend fun <T : androidx.health.connect.client.records.Record> readRecords(
        client: HealthConnectClient,
        recordType: KClass<T>,
        start: Instant,
        end: Instant
    ): List<T> {
        val response = client.readRecords(
            ReadRecordsRequest(
                recordType = recordType,
                timeRangeFilter = TimeRangeFilter.between(start, end)
            )
        )

        return response.records
    }

    private fun summarizeMetrics(records: List<ApiHealthRecord>): List<MetricSnapshot> {
        return records
            .groupBy { it.metricType }
            .mapNotNull { (metricType, metricRecords) ->
                val latest = metricRecords.maxByOrNull { it.endTime } ?: return@mapNotNull null
                MetricSnapshot(
                    metricType = metricType,
                    label = metricLabel(metricType),
                    value = formatMetricValue(latest.value),
                    unit = latest.unit,
                    measuredAt = latest.endTime,
                    sourceDevice = latest.sourceDevice,
                    samples = metricRecords.size
                )
            }
            .sortedBy { it.label }
    }

    private fun metricLabel(metricType: String): String = when (metricType) {
        "age" -> "Age"
        "steps" -> "Steps"
        "heart_rate" -> "Heart Rate"
        "sleep" -> "Sleep"
        "blood_glucose" -> "Blood Glucose"
        "blood_pressure_systolic" -> "Systolic BP"
        "blood_pressure_diastolic" -> "Diastolic BP"
        "weight" -> "Weight"
        "body_fat" -> "Body Fat"
        "height" -> "Height"
        "oxygen_saturation" -> "Oxygen Saturation"
        "hydration" -> "Water Intake"
        "exercise" -> "Exercise"
        "active_calories_burned" -> "Active Calories"
        "total_calories_burned" -> "Total Calories"
        "distance" -> "Distance"
        "power" -> "Power"
        "speed" -> "Speed"
        "vo2_max" -> "VO2 Max"
        "basal_metabolic_rate" -> "Basal Metabolic Rate"
        "nutrition_energy" -> "Nutrition Energy"
        else -> metricType.replace('_', ' ')
    }

    private fun formatMetricValue(value: Double): String {
        val rounded = value.roundToInt().toDouble()
        return if (value == rounded) rounded.toInt().toString() else String.format(Locale.US, "%.1f", value)
    }

    private fun toApiRecord(
        metadata: Metadata,
        metricType: String,
        startTime: String,
        endTime: String,
        value: Double,
        unit: String,
        metadataExtras: Map<String, String> = emptyMap()
    ): ApiHealthRecord {
        val sourceApp = metadata.dataOrigin.packageName.ifBlank { "health_connect_source" }
        val manufacturer = metadata.device?.manufacturer?.takeIf { it.isNotBlank() }
        val model = metadata.device?.model?.takeIf { it.isNotBlank() }
        val sourceDevice = listOfNotNull(manufacturer, model).joinToString(" ").ifBlank { "Android device" }

        return ApiHealthRecord(
            sourceRecordId = metadata.id.ifBlank { "$metricType-$startTime" },
            metricType = metricType,
            startTime = startTime,
            endTime = endTime,
            value = value,
            unit = unit,
            sourceApp = sourceApp,
            sourceDevice = sourceDevice,
            metadata = metadataExtras
        )
    }
}

