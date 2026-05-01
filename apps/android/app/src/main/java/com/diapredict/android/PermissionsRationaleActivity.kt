package com.diapredict.android

import android.os.Bundle
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity

class PermissionsRationaleActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val padding = (24 * resources.displayMetrics.density).toInt()

        val title = TextView(this).apply {
            text = "Why DiaPredict requests Health Connect access"
            textSize = 22f
        }

        val body = TextView(this).apply {
            text = "DiaPredict reads health data that you explicitly approve, such as steps, heart rate, sleep, exercise, weight, oxygen saturation, and blood glucose. The app uploads those records to your DiaPredict backend so they can appear in your web dashboard. DiaPredict does not write data back to Health Connect in this build."
            textSize = 16f
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding, padding, padding)
            addView(title)
            addView(body)
        }

        setContentView(ScrollView(this).apply {
            addView(container)
        })
    }
}
