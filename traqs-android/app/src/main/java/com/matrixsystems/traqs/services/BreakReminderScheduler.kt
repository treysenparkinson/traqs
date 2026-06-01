package com.matrixsystems.traqs.services

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

// Schedules a single local notification that fires ~2 minutes before a worker's
// configured break duration elapses. Mirrors iOS BreakReminder.swift. Local
// (not OneSignal push) because the duration is known at break-start time, so
// an on-device alarm is simpler and fires reliably even offline.

object BreakReminderScheduler {
    private const val CHANNEL_ID = "traqs.break.reminder"
    private const val NOTIFICATION_ID = 9_101
    private const val REQUEST_CODE = 9_101
    private const val LEAD_MINUTES = 2

    fun schedule(context: Context, durationMinutes: Int) {
        ensureChannel(context)
        cancel(context)  // wipe any prior pending alarm

        val leadSeconds = maxOf(0, durationMinutes - LEAD_MINUTES) * 60L
        val triggerSeconds = maxOf(5L, leadSeconds)
        val triggerAt = System.currentTimeMillis() + triggerSeconds * 1000

        val intent = Intent(context, BreakReminderReceiver::class.java).apply {
            putExtra("durationMinutes", durationMinutes)
        }
        val pi = PendingIntent.getBroadcast(
            context.applicationContext, REQUEST_CODE, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val am = ContextCompat.getSystemService(context, AlarmManager::class.java) ?: return
        // setExactAndAllowWhileIdle survives Doze; closest semantic match to
        // iOS UNTimeIntervalNotificationTrigger.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (am.canScheduleExactAlarms()) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            } else {
                // Fall back to inexact — we don't have SCHEDULE_EXACT_ALARM grant.
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            }
        } else {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
        }
    }

    fun cancel(context: Context) {
        val intent = Intent(context, BreakReminderReceiver::class.java)
        val pi = PendingIntent.getBroadcast(
            context.applicationContext, REQUEST_CODE, intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        ) ?: return
        ContextCompat.getSystemService(context, AlarmManager::class.java)?.cancel(pi)
        pi.cancel()
    }

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = ContextCompat.getSystemService(context, NotificationManager::class.java) ?: return
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID, "Break reminders",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply { description = "Heads-up before your break ends." }
                nm.createNotificationChannel(channel)
            }
        }
    }

    internal fun fireNotification(context: Context, durationMinutes: Int) {
        ensureChannel(context)
        val body = if (durationMinutes > LEAD_MINUTES)
            "Your break ends in $LEAD_MINUTES minutes."
        else
            "Your break is about to end."

        val n = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Break ending soon")
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, n) }
    }
}

class BreakReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val minutes = intent.getIntExtra("durationMinutes", 15)
        BreakReminderScheduler.fireNotification(context, minutes)
    }
}
