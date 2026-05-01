package com.diapredict.android

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class SyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        val coordinator = HealthConnectSyncCoordinator(applicationContext)
        val result = coordinator.syncLast24Hours()

        return if (result.status == "success") {
            Result.success()
        } else {
            Result.retry()
        }
    }
}
