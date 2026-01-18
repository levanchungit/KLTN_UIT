package com.levanchung.it.KLTN_UIT

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.util.Log
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import androidx.core.app.NotificationManagerCompat

class QuickAddWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val views = RemoteViews(context.packageName, R.layout.widget_quick_add)
        // Force widget to always deep-link into chatbot (bypass login file check)
        val isLoggedIn = true
        Log.i(TAG, "onUpdate called, force isLoggedIn=$isLoggedIn (widget will always open chatbot)")

        if (isLoggedIn) {
            // Fake input area: open chatbot (text mode) — use explicit MainActivity component
            val uriInput = android.net.Uri.parse("kltnuit://chatbot?source=widget&mode=text")
            // Instead send a broadcast so provider can log and then start the activity explicitly
            val inputIntent = Intent(context, QuickAddWidgetProvider::class.java).apply {
                action = ACTION_OPEN_CHATBOX
                putExtra(EXTRA_MODE, "text")
                putExtra(EXTRA_URI, uriInput.toString())
            }
            val pInput = PendingIntent.getBroadcast(context, 400, inputIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            Log.i(TAG, "setOnClickPendingIntent for input (mode=text)")
            views.setOnClickPendingIntent(R.id.widget_input_area, pInput)

            // Voice button: open chatbot in voice mode
            val uriVoice = android.net.Uri.parse("kltnuit://chatbot?source=widget&mode=voice")
            val voiceIntent = Intent(context, QuickAddWidgetProvider::class.java).apply {
                action = ACTION_OPEN_CHATBOX
                putExtra(EXTRA_MODE, "voice")
                putExtra(EXTRA_URI, uriVoice.toString())
            }
            val pVoice = PendingIntent.getBroadcast(context, 401, voiceIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            Log.i(TAG, "setOnClickPendingIntent for voice (mode=voice)")
            views.setOnClickPendingIntent(R.id.action_voice, pVoice)

            // Image button: open chatbot in image mode
            val uriImage = android.net.Uri.parse("kltnuit://chatbot?source=widget&mode=image")
            val imageIntent = Intent(context, QuickAddWidgetProvider::class.java).apply {
                action = ACTION_OPEN_CHATBOX
                putExtra(EXTRA_MODE, "image")
                putExtra(EXTRA_URI, uriImage.toString())
            }
            val pImage = PendingIntent.getBroadcast(context, 402, imageIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            Log.i(TAG, "setOnClickPendingIntent for image (mode=image)")
            views.setOnClickPendingIntent(R.id.action_image, pImage)
        } else {
            // Not logged in: clicking any of these will post a login reminder notification
            val loginNotifyIntent = Intent(context, QuickAddWidgetProvider::class.java).apply {
                action = ACTION_POST_LOGIN_NOTIFICATION
            }
            val pLoginNotify = PendingIntent.getBroadcast(context, 410, loginNotifyIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            views.setOnClickPendingIntent(R.id.widget_input_area, pLoginNotify)
            views.setOnClickPendingIntent(R.id.action_voice, pLoginNotify)
            views.setOnClickPendingIntent(R.id.action_image, pLoginNotify)
        }

        val componentName = ComponentName(context, QuickAddWidgetProvider::class.java)
        appWidgetManager.updateAppWidget(componentName, views)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        Log.i(TAG, "onReceive action=${intent.action}")
        when (intent.action) {
            ACTION_OPEN_CHATBOX -> {
                val mode = intent.getStringExtra(EXTRA_MODE) ?: "text"
                val uriStr = intent.getStringExtra(EXTRA_URI)
                Log.i(TAG, "ACTION_OPEN_CHATBOX received mode=$mode uri=$uriStr")
                // Build explicit intent to MainActivity
                val uri = if (uriStr != null) android.net.Uri.parse(uriStr) else android.net.Uri.parse("kltnuit://chatbot?source=widget&mode=$mode")
                val start = Intent(Intent.ACTION_VIEW).apply {
                    data = uri
                    setComponent(ComponentName(context, MainActivity::class.java))
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                }
                try {
                    context.startActivity(start)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to start MainActivity from widget", e)
                    // Fallback: create a notification that contains an action to open the app
                    postOpenFallbackNotification(context, uri)
                }
                return
            }
            ACTION_QUICK_ADD -> {
                val amount = intent.getDoubleExtra(EXTRA_AMOUNT, 0.0)
                val note = intent.getStringExtra(EXTRA_NOTE) ?: ""
                QuickAddHelper.insertQuickTransaction(context, amount, note)
            }
            ACTION_POST_NOTIFICATION -> {
                postInputNotification(context)
            }
            ACTION_POST_LOGIN_NOTIFICATION -> {
                postLoginNotification(context)
            }
            ACTION_REMOTE_REPLY -> {
                // RemoteInput reply arrives here
                val results = RemoteInput.getResultsFromIntent(intent)
                val reply = results?.getCharSequence(KEY_REMOTE_INPUT)?.toString() ?: null
                if (reply != null) {
                    // Try to parse leading amount, otherwise put as note
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
                // Dismiss notification
                val nm = NotificationManagerCompat.from(context)
                nm.cancel(NOTIFICATION_ID)
            }
        }
    }

    private fun postInputNotification(context: Context) {
        val channelId = "quick_add_channel"
        createChannelIfNeeded(context, channelId)

        val remoteInput = RemoteInput.Builder(KEY_REMOTE_INPUT)
            .setLabel("Nhập số và ghi chú, ví dụ: 50k cafe")
            .build()

        val replyIntent = Intent(context, QuickAddWidgetProvider::class.java).apply {
            action = ACTION_REMOTE_REPLY
        }
        val replyPending = PendingIntent.getBroadcast(context, 300, replyIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val action = NotificationCompat.Action.Builder(0, "Gửi", replyPending)
            .addRemoteInput(remoteInput)
            .build()

        val builder = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_input_add)
            .setContentTitle("Thêm giao dịch nhanh")
            .setContentText("Nhập số tiền và ghi chú")
            .addAction(action)
            .setAutoCancel(true)

        with(NotificationManagerCompat.from(context)) {
            notify(NOTIFICATION_ID, builder.build())
        }
    }

    private fun createChannelIfNeeded(context: Context, channelId: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "Quick Add"
            val desc = "Notifications for quick-add widget input"
            val importance = NotificationManager.IMPORTANCE_DEFAULT
            val chan = NotificationChannel(channelId, name, importance)
            chan.description = desc
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(chan)
        }
    }

    private fun postLoginNotification(context: Context) {
        val channelId = "quick_add_channel"
        createChannelIfNeeded(context, channelId)

        val loginUri = android.net.Uri.parse("kltnuit://auth/login?source=widget")
        val loginIntent = Intent(Intent.ACTION_VIEW, loginUri)
        val loginPending = PendingIntent.getActivity(context, 500, loginIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val builder = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Bạn cần đăng nhập")
            .setContentText("Mở app để đăng nhập và sử dụng widget")
            .setAutoCancel(true)
            .addAction(android.R.drawable.ic_menu_view, "Mở đăng nhập", loginPending)

        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID + 1, builder.build())
    }

    private fun postOpenFallbackNotification(context: Context, uri: android.net.Uri) {
        val channelId = "quick_add_channel"
        createChannelIfNeeded(context, channelId)

        val openIntent = Intent(Intent.ACTION_VIEW).apply {
            data = uri
            setComponent(ComponentName(context, MainActivity::class.java))
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val openPending = PendingIntent.getActivity(context, 600, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val builder = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Mở ứng dụng")
            .setContentText("Nhấn để mở chatbot")
            .addAction(android.R.drawable.ic_menu_view, "Mở chatbot", openPending)
            .setAutoCancel(true)

        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID + 2, builder.build())
    }

    companion object {
        const val TAG = "QuickAddWidgetProvider"
        const val ACTION_OPEN_CHATBOX = "com.levanchung.it.KLTN_UIT.ACTION_OPEN_CHATBOX"
        const val EXTRA_MODE = "extra_mode"
        const val EXTRA_URI = "extra_uri"
        const val ACTION_QUICK_ADD = "com.levanchung.it.KLTN_UIT.ACTION_QUICK_ADD"
        const val EXTRA_AMOUNT = "extra_amount"
        const val EXTRA_NOTE = "extra_note"

        const val ACTION_POST_NOTIFICATION = "com.levanchung.it.KLTN_UIT.ACTION_POST_INPUT_NOTIFICATION"
        const val ACTION_REMOTE_REPLY = "com.levanchung.it.KLTN_UIT.ACTION_REMOTE_REPLY"
        const val KEY_REMOTE_INPUT = "key_remote_input"
        const val NOTIFICATION_ID = 12345
        const val ACTION_POST_LOGIN_NOTIFICATION = "com.levanchung.it.KLTN_UIT.ACTION_POST_LOGIN_NOTIFICATION"
    }
}
