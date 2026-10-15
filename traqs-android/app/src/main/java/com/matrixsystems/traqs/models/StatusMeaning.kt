package com.matrixsystems.traqs.models

import com.google.gson.JsonElement
import com.google.gson.JsonObject

// #504 — WHAT A STATUS MEANS LIVES ON THE ORG'S LIST ENTRY, NOT IN ITS SPELLING.
//
// A port of src/statusMeaning.js (and iOS's Services/StatusMeaning.swift), in the PAGE-LEVEL
// form: the app serves one org, so AppState installs that org's list here whenever its
// settings arrive. An entry may carry `isFinished` / `isActive`; for each flag separately, a
// list where NO entry carries it reads the meaning from the name ("finished", "in progress",
// normalised) — every org's list today — so nothing moves until the web saves the list.
//
// #523/#524(3) — THE NULL READ. Gson reads a status or priority value this app has no enum
// case for ("MTX FAT", "On time", Matrix's lowercase "finished") as null into the node's
// non-null field, and any screen reading it could throw. The node classes now store the field
// as read (`statusOrNull`, still serialised as "status", so the passthrough keeps the raw value
// on save exactly as before — see Passthrough.kt) and expose `status` / `pri` through here,
// which never return null: the raw value comes from the node's `extras`, and its MEANING from
// the org's list.
//
// NOT COMPILED: this machine has no JDK or Android SDK. Checked by source shape in
// scripts/android-native-test.mjs only.
object StatusMeaning {
    private data class Entry(val key: String, val isFinished: Boolean, val isActive: Boolean)

    @Volatile private var entries: List<Entry>? = null

    fun normalize(s: String?): String = (s ?: "").trim().replace(Regex("\\s+"), " ").lowercase()

    private val FINISHED_NAME = normalize("Finished")
    private val ACTIVE_NAME = normalize("In Progress")

    /** Installed from OrgSettings' `statusOpts` (unmodelled, so it lives in `extras`). Null or empty clears it. */
    fun install(statusOpts: JsonElement?) {
        val rows = if (statusOpts != null && statusOpts.isJsonArray)
            statusOpts.asJsonArray.mapNotNull { if (it.isJsonObject) it.asJsonObject else null }
        else emptyList()
        if (rows.isEmpty()) { entries = null; return }
        fun flag(o: JsonObject, k: String) = o.get(k)?.let { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean && it.asBoolean } == true
        fun name(o: JsonObject) = o.get("name")?.let { if (it.isJsonPrimitive) it.asString else null } ?: ""
        val anyFin = rows.any { flag(it, "isFinished") }
        val anyAct = rows.any { flag(it, "isActive") }
        entries = rows.map { o ->
            val k = normalize(name(o))
            Entry(
                key = k,
                isFinished = if (anyFin) flag(o, "isFinished") else k == FINISHED_NAME,
                isActive = if (anyAct) flag(o, "isActive") else k == ACTIVE_NAME,
            )
        }
    }

    private fun means(status: String?, finished: Boolean): Boolean {
        val s = normalize(status)
        val hit = entries?.filter { it.key == s }.orEmpty()
        if (hit.isNotEmpty()) return hit.any { if (finished) it.isFinished else it.isActive }
        // Not in the list (or no list): the name decides, as everything did before the flag.
        return s == (if (finished) FINISHED_NAME else ACTIVE_NAME)
    }

    fun isFinished(status: String?): Boolean = means(status, finished = true)
    fun isActive(status: String?): Boolean = means(status, finished = false)

    /** The node's status as this app's enum, by MEANING. Never null. */
    fun statusOf(read: JobStatus?, extras: JsonObject?): JobStatus {
        val raw = read?.label ?: extras?.get("status")?.let { if (it.isJsonPrimitive) it.asString else null }
        if (isFinished(raw)) return JobStatus.FINISHED
        if (isActive(raw)) return JobStatus.IN_PROGRESS
        // Neither meaning: the case whose name it is, if any — but never Finished or In Progress
        // by spelling alone, since the list just said it does not mean that.
        val n = normalize(raw)
        return JobStatus.entries.firstOrNull {
            it != JobStatus.FINISHED && it != JobStatus.IN_PROGRESS && normalize(it.label) == n
        } ?: JobStatus.NOT_STARTED
    }

    /** The node's priority. A value with no case reads as Medium rather than null; the raw value is kept on save. */
    fun priOf(read: Priority?): Priority = read ?: Priority.MEDIUM
}
