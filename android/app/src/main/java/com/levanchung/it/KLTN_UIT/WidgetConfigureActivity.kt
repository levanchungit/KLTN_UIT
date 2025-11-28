package com.levanchung.it.KLTN_UIT

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.EditText

class WidgetConfigureActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_widget_configure)

        val edit = findViewById<EditText>(R.id.edit_text_quick)
        val btn = findViewById<Button>(R.id.btn_submit_quick)

        btn.setOnClickListener {
            val text = edit.text.toString().trim()
            if (text.isNotEmpty()) {
                // Open the app using deep link with the text
                val uri = Uri.parse("kltnuit://add?text=" + Uri.encode(text))
                val intent = Intent(Intent.ACTION_VIEW, uri)
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                startActivity(intent)
            }

            // Finish configuration
            val resultValue = Intent()
            resultValue.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            setResult(RESULT_OK, resultValue)
            finish()
        }
    }
}
