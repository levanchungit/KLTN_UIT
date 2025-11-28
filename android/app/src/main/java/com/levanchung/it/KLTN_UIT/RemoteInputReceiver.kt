package com.levanchung.it.KLTN_UIT

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.RemoteInput

class RemoteInputReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        try {
            val results = RemoteInput.getResultsFromIntent(intent)
            val reply = results?.getCharSequence(QuickAddWidgetProvider.KEY_REMOTE_INPUT)?.toString()
            if (reply != null) {
                // Attempt to parse amount
                    val m = Regex("^([0-9.,]+)\\s*(.*)").find(reply.trim())
                if (m != null) {
                    val rawNum = m.groupValues[1]
                    val rest = m.groupValues[2]
                    val normalized = rawNum.replace(",", "")
                    val n = normalized.toDoubleOrNull() ?: 0.0
                    QuickAddHelper.insertQuickTransaction(context, n, rest ?: "")
                } else {
                    QuickAddHelper.insertQuickTransaction(context, 0.0, reply)
                }
            }
        } catch (e: Exception) {
            Log.e("RemoteInputReceiver", "Failed to handle remote input", e)
        }
    }
}
