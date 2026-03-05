package com.levanchung.it.KLTN_UIT

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class WidgetUpdateModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "WidgetUpdateModule"
    }

    override fun getName(): String = "WidgetUpdateModule"

    /**
     * Force refresh all QuickAddWidget instances.
     * Called from JS whenever balance changes (transaction add/edit/delete,
     * sync complete, app going to background, etc.)
     */
    @ReactMethod
    fun updateWidget(promise: Promise) {
        try {
            val context: Context = reactApplicationContext
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val componentName = ComponentName(context, QuickAddWidgetProvider::class.java)
            val appWidgetIds = appWidgetManager.getAppWidgetIds(componentName)

            if (appWidgetIds.isEmpty()) {
                Log.i(TAG, "No widget instances found, skipping update")
                promise.resolve(false)
                return
            }

            Log.i(TAG, "Forcing widget update for ${appWidgetIds.size} widget(s): ${appWidgetIds.joinToString()}")

            val updateIntent = Intent(context, QuickAddWidgetProvider::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, appWidgetIds)
            }
            context.sendBroadcast(updateIntent)

            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update widget", e)
            promise.reject("WIDGET_UPDATE_ERROR", e.message, e)
        }
    }

    /**
     * Fire-and-forget version (no promise). Useful for background calls.
     */
    @ReactMethod
    fun updateWidgetSilent() {
        try {
            val context: Context = reactApplicationContext
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val componentName = ComponentName(context, QuickAddWidgetProvider::class.java)
            val appWidgetIds = appWidgetManager.getAppWidgetIds(componentName)

            if (appWidgetIds.isEmpty()) {
                Log.i(TAG, "updateWidgetSilent: No widget instances")
                return
            }

            Log.i(TAG, "updateWidgetSilent: Refreshing ${appWidgetIds.size} widget(s)")

            val updateIntent = Intent(context, QuickAddWidgetProvider::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, appWidgetIds)
            }
            context.sendBroadcast(updateIntent)
        } catch (e: Exception) {
            Log.e(TAG, "updateWidgetSilent failed", e)
        }
    }
}
