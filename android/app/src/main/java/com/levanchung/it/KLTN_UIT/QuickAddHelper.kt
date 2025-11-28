package com.levanchung.it.KLTN_UIT

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.lang.Exception
import android.database.sqlite.SQLiteDatabase
import java.util.Locale

object QuickAddHelper {
    private const val TAG = "QuickAddHelper"
    private const val USER_FILE = "kltn_widget_user.json"

    fun readUserId(context: Context): String? {
        try {
            // Check common locations where JS might write the widget file
            val candidates = mutableListOf<File>()
            candidates.add(File(context.filesDir, USER_FILE))
            val external = context.getExternalFilesDir(null)
            if (external != null) candidates.add(File(external, USER_FILE))
            // Also search under app data directory for any matching file (best-effort)
            val dataDir = context.dataDir
            if (dataDir != null) {
                // shallow search for the file name to handle different JS FS paths
                val found = findFileRecursive(dataDir, USER_FILE, 4)
                if (found != null) candidates.add(found)
            }

            for (f in candidates) {
                try {
                    Log.i(TAG, "Checking user file: ${f.absolutePath}")
                    if (!f.exists()) continue
                    val text = f.readText()
                    val j = JSONObject(text)
                    val id = j.optString("id", null)
                    if (id != null && id.isNotEmpty()) {
                        Log.i(TAG, "Found widget user id in: ${f.absolutePath}")
                        return id
                    }
                } catch (inner: Exception) {
                    Log.w(TAG, "Failed to read candidate file ${f.absolutePath}", inner)
                }
            }
            return null
        } catch (e: Exception) {
            Log.w(TAG, "Cannot read user file", e)
            return null
        }
    }

    private fun findFileRecursive(dir: File, name: String, depth: Int): File? {
        if (depth < 0) return null
        try {
            val files = dir.listFiles() ?: return null
            for (f in files) {
                if (f.isFile && f.name == name) return f
            }
            for (f in files) {
                if (f.isDirectory) {
                    val r = findFileRecursive(f, name, depth - 1)
                    if (r != null) return r
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error searching for file in ${dir.absolutePath}", e)
        }
        return null
    }

    fun insertQuickTransaction(context: Context, amount: Double, note: String) {
        try {
            val userId = readUserId(context)
            if (userId == null) {
                Log.w(TAG, "No user id for quick add")
                return
            }

            // Open app database
            val dbPath = context.getDatabasePath("money.db").path
            val db = SQLiteDatabase.openDatabase(dbPath, null, SQLiteDatabase.OPEN_READWRITE)

            // Find default account
            var accountId: String? = null
            val c = db.rawQuery("SELECT id FROM accounts ORDER BY include_in_total DESC LIMIT 1", null)
            if (c.moveToFirst()) {
                accountId = c.getString(0)
            }
            c.close()
            if (accountId == null) {
                Log.w(TAG, "No account found, skipping quick add")
                db.close()
                return
            }

            val id = "tx_" + java.lang.Double.toString(Math.random()).replace("0.", "").take(6)
            val nowSec = System.currentTimeMillis() / 1000

            val sql = "INSERT INTO transactions(id,user_id,account_id,category_id,type,amount,note,occurred_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)"
            val stmt = db.compileStatement(sql)
            stmt.bindString(1, id)
            stmt.bindString(2, userId)
            stmt.bindString(3, accountId)
            stmt.bindNull(4)
            stmt.bindString(5, "expense")
            stmt.bindDouble(6, amount)
            stmt.bindString(7, if (note.isNotEmpty()) note else "")
            stmt.bindLong(8, nowSec)
            stmt.bindLong(9, nowSec)
            stmt.executeInsert()

            // Optionally trigger further native checks (skip training etc.)
            db.close()
            Log.i(TAG, "Inserted quick tx: $id amount=$amount")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to insert quick tx", e)
        }
    }
}
