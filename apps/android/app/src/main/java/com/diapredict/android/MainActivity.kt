package com.diapredict.android

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.health.connect.client.PermissionController
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val PageBackground = Brush.verticalGradient(
    colors = listOf(
        Color(0xFF0F172A), // Slate 900
        Color(0xFF020617), // Slate 950
        Color(0xFF000000)
    )
)

private val HeroGradient = Brush.linearGradient(
    colors = listOf(
        Color(0xFF0D9488), // Teal 600
        Color(0xFF0F766E), // Teal 700
        Color(0xFF115E59)  // Teal 800
    )
)

private val Accent = Color(0xFF14B8A6) // Teal 400
private val PrimaryText = Color(0xFFCCFBF1) // Teal 50 (used for primary text headers)
private val SoftSurface = Color(0xFF1E293B) // Slate 800
private val SurfaceHighlight = Color(0xFF334155) // Slate 700
private val MutedText = Color(0xFF94A3B8) // Slate 400
private val EmptyTint = Color(0xFF334155)
private val MetricAccent = Color(0xFF2DD4BF) // Teal 300
private val TimeFormatter: DateTimeFormatter = DateTimeFormatter.ofPattern("dd MMM, hh:mm a")

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            MaterialTheme {
                Surface {
                    SyncApp()
                }
            }
        }
    }
}

@Composable
private fun SyncApp() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val coordinator = remember { HealthConnectSyncCoordinator(context) }

    var sdkMessage by remember { mutableStateOf("Checking Health Connect availability...") }
    var permissionMessage by remember { mutableStateOf("Permissions not checked yet.") }
    var syncMessage by remember { mutableStateOf("No sync has run yet.") }
    var metrics by remember { mutableStateOf(emptyList<MetricSnapshot>()) }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = PermissionController.createRequestPermissionResultContract()
    ) { granted ->
        permissionMessage = if (granted.isEmpty()) {
            "No permissions granted yet. Open Health Connect and allow DiaPredict Sync."
        } else {
            "Granted ${granted.size} Health Connect permissions."
        }
        SyncScheduler.schedule(context)
        scope.launch {
            metrics = coordinator.previewLast24Hours()
        }
    }

    LaunchedEffect(Unit) {
        sdkMessage = when (coordinator.sdkStatus()) {
            3 -> "Health Connect is available on this device."
            2 -> "Health Connect needs to be installed or updated."
            else -> "Health Connect is not available on this device."
        }

        val granted = coordinator.getGrantedPermissions()
        permissionMessage = if (granted.isEmpty()) {
            "No health data permissions granted yet."
        } else {
            "Already granted ${granted.size} Health Connect permissions."
        }

        if (granted.isNotEmpty()) {
            metrics = coordinator.previewLast24Hours()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(PageBackground)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            HeroCard()
            StatusPanel(title = "SDK Status", body = sdkMessage, tone = statusTone(sdkMessage))
            StatusPanel(title = "Permissions", body = permissionMessage, tone = statusTone(permissionMessage))
            StatusPanel(title = "Sync", body = syncMessage, tone = statusTone(syncMessage))
            ActionPanel(
                onGrantAccess = { permissionLauncher.launch(coordinator.requestedPermissions) },
                onSyncNow = {
                    scope.launch {
                        val result = coordinator.syncLast24Hours()
                        syncMessage = "${result.status}: ${result.message}"
                        metrics = result.metrics
                    }
                },
                onEnableBackgroundSync = {
                    SyncScheduler.schedule(context)
                    syncMessage = "Hourly background sync scheduled."
                }
            )
            MetricsPanel(metrics = metrics)
            FootnoteCard()
            Spacer(modifier = Modifier.height(8.dp))
        }
    }
}

@Composable
private fun HeroCard() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(32.dp),
        colors = CardDefaults.cardColors(containerColor = Color.Transparent)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(32.dp))
                .background(HeroGradient)
                .padding(24.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(180.dp, 68.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Image(
                            painter = painterResource(id = R.drawable.diapredict_logo),
                            contentDescription = "DiaPredict logo",
                            modifier = Modifier.fillMaxWidth().padding(8.dp),
                            contentScale = ContentScale.FillWidth,
                            colorFilter = ColorFilter.tint(Color.White)
                        )
                    }

                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = "DiaPredict Sync",
                            style = MaterialTheme.typography.headlineSmall,
                            color = Color.White,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Samsung Health to dashboard bridge via Health Connect",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color.White.copy(alpha = 0.88f)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun HeroChip(label: String) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(Color.White.copy(alpha = 0.14f))
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        Text(
            text = label,
            color = Color.White,
            style = MaterialTheme.typography.labelLarge
        )
    }
}

@Composable
private fun StatusPanel(title: String, body: String, tone: Color) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(26.dp),
        colors = CardDefaults.cardColors(containerColor = SoftSurface)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(18.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.Top
        ) {
            Box(
                modifier = Modifier
                    .size(14.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(tone)
            )
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = PrimaryText
                )
                Text(
                    text = body,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MutedText
                )
            }
        }
    }
}

@Composable
private fun ActionPanel(
    onGrantAccess: () -> Unit,
    onSyncNow: () -> Unit,
    onEnableBackgroundSync: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(30.dp),
        colors = CardDefaults.cardColors(containerColor = SoftSurface)
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text(
                text = "Quick actions",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = PrimaryText
            )
            Text(
                text = "Connect Samsung Health to Health Connect first, then grant access here and run a manual sync. Background sync can be enabled after the initial permissions flow succeeds.",
                style = MaterialTheme.typography.bodyMedium,
                color = MutedText
            )
            Button(
                onClick = onGrantAccess,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Accent)
            ) {
                Text("Grant Access")
            }
            Button(
                onClick = onSyncNow,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF0F766E), // Teal 700
                    contentColor = PrimaryText
                )
            ) {
                Text("Sync Now")
            }
            OutlinedButton(
                onClick = onEnableBackgroundSync,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = PrimaryText
                )
            ) {
                Text("Enable Hourly Background Sync")
            }
        }
    }
}

@Composable
private fun MetricsPanel(metrics: List<MetricSnapshot>) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(30.dp),
        colors = CardDefaults.cardColors(containerColor = SoftSurface)
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text(
                text = "Recent metrics",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = PrimaryText
            )
            Text(
                text = if (metrics.isEmpty()) {
                    "Run a sync to display recent Health Connect values directly on the phone."
                } else {
                    "Latest values found in the last 30 days on this device."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MutedText
            )

            if (metrics.isEmpty()) {
                EmptyMetricsState()
            } else {
                metrics.forEach { metric ->
                    MetricCard(metric = metric)
                }
            }
        }
    }
}

@Composable
private fun EmptyMetricsState() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(SurfaceHighlight)
            .padding(18.dp)
    ) {
        Text(
            text = "No metric preview available yet.",
            style = MaterialTheme.typography.bodyMedium,
            color = MutedText
        )
    }
}

@Composable
private fun MetricCard(metric: MetricSnapshot) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(containerColor = SurfaceHighlight)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = metric.label,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = PrimaryText
                )
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(Color(0xFF042F2E)) // Teal 950
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = "${metric.samples} sample${if (metric.samples == 1) "" else "s"}",
                        style = MaterialTheme.typography.labelMedium,
                        color = MetricAccent
                    )
                }
            }

            Text(
                text = "${metric.value} ${metric.unit}",
                style = MaterialTheme.typography.headlineSmall,
                color = MetricAccent,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Measured ${formatTimestamp(metric.measuredAt)}",
                style = MaterialTheme.typography.bodyMedium,
                color = MutedText
            )
            Text(
                text = "Source: ${metric.sourceDevice}",
                style = MaterialTheme.typography.bodySmall,
                color = MutedText
            )
        }
    }
}

@Composable
private fun FootnoteCard() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = SoftSurface)
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = "How this app works",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = PrimaryText
            )
            Text(
                text = "This Android app reads the Samsung Health-backed Health Connect record types you approve, then uploads them to the DiaPredict backend so they can appear on the web dashboard.",
                style = MaterialTheme.typography.bodyMedium,
                color = MutedText,
                textAlign = TextAlign.Start
            )
        }
    }
}

private fun statusTone(message: String): Color {
    val normalized = message.lowercase()
    return when {
        "granted" in normalized || "available" in normalized || "success" in normalized -> Color(0xFF1FA971)
        "need" in normalized || "required" in normalized || "no permissions" in normalized -> Color(0xFFF59E0B)
        else -> Color(0xFF94A3B8)
    }
}

private fun formatTimestamp(value: String): String {
    return runCatching {
        val instant = Instant.parse(value)
        instant.atZone(ZoneId.systemDefault()).format(TimeFormatter)
    }.getOrDefault(value)
}








