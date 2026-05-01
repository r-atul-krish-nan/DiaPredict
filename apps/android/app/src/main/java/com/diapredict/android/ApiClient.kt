package com.diapredict.android

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class ApiClient {
    companion object {
        private const val USE_EMULATOR = false
        private const val EMULATOR_BASE_URL = "http://10.0.2.2:4000"
        private const val DEVICE_BASE_URL = "http://192.168.29.72:4000"
        private val BASE_URL = if (USE_EMULATOR) EMULATOR_BASE_URL else DEVICE_BASE_URL
        private const val USER_ID = "demo-user"
    }

    fun uploadBatch(payload: SyncPayload): SyncResultState {
        val connection = (URL("$BASE_URL/api/v1/sync/batch").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15_000
            readTimeout = 15_000
            doInput = true
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("x-user-id", USER_ID)
        }

        return try {
            OutputStreamWriter(connection.outputStream).use { writer ->
                writer.write(toJson(payload).toString())
                writer.flush()
            }

            val responseCode = connection.responseCode
            val responseBody = readBody(connection)

            if (responseCode in 200..299) {
                SyncResultState(
                    status = "success",
                    message = responseBody.ifBlank { "Upload completed" },
                    uploadedCount = payload.records.size
                )
            } else {
                SyncResultState(
                    status = "error",
                    message = "Upload failed with HTTP $responseCode: $responseBody"
                )
            }
        } catch (exception: Exception) {
            SyncResultState(
                status = "error",
                message = exception.message ?: "Unexpected upload failure"
            )
        } finally {
            connection.disconnect()
        }
    }

    private fun toJson(payload: SyncPayload): JSONObject {
        val records = JSONArray()
        payload.records.forEach { record ->
            records.put(
                JSONObject()
                    .put("sourceRecordId", record.sourceRecordId)
                    .put("metricType", record.metricType)
                    .put("startTime", record.startTime)
                    .put("endTime", record.endTime)
                    .put("value", record.value)
                    .put("unit", record.unit)
                    .put("sourceApp", record.sourceApp)
                    .put("sourceDevice", record.sourceDevice)
                    .put("metadata", JSONObject(record.metadata))
            )
        }

        return JSONObject()
            .put("cursor", payload.cursor)
            .put("records", records)
    }

    private fun readBody(connection: HttpURLConnection): String {
        val stream = if (connection.responseCode in 200..299) {
            connection.inputStream
        } else {
            connection.errorStream
        } ?: return ""

        return BufferedReader(stream.reader()).use { reader ->
            reader.readText()
        }
    }
}

