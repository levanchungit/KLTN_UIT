package com.levanchung.it.KLTN_UIT

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.TextView

class WidgetConfigureActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Use the widget layout directly as the activity content so the configure
        // screen shows the same UI as the widget. This avoids failures when
        // `activity_widget_configure` isn't generated into R for any reason.
        setContentView(R.layout.widget_quick_add)

        // The activity now includes `widget_quick_add.xml` which defines
        // `widget_input_area`. We no longer read text from there since it is static labels.
        val btn = findViewById<ImageButton>(R.id.action_image)

        btn.setOnClickListener {
            // Open the app using deep link
            val uri = Uri.parse("kltnuit://add")
            val intent = Intent(Intent.ACTION_VIEW, uri)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            startActivity(intent)

            // Finish configuration
            val resultValue = Intent()
            resultValue.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            setResult(RESULT_OK, resultValue)
            finish()
        }
    }
}
