package com.matrixsystems.traqs.models

import com.google.gson.annotations.SerializedName

// MARK: - Enums

enum class JobStatus(val label: String) {
    @SerializedName("Not Started") NOT_STARTED("Not Started"),
    @SerializedName("Pending") PENDING("Pending"),
    @SerializedName("In Progress") IN_PROGRESS("In Progress"),
    @SerializedName("On Hold") ON_HOLD("On Hold"),
    @SerializedName("Finished") FINISHED("Finished");

    companion object {
        fun fromLabel(label: String) = entries.firstOrNull { it.label == label } ?: NOT_STARTED
    }
}

enum class Priority(val label: String) {
    @SerializedName("Low") LOW("Low"),
    @SerializedName("Medium") MEDIUM("Medium"),
    @SerializedName("High") HIGH("High");

    companion object {
        fun fromLabel(label: String) = entries.firstOrNull { it.label == label } ?: MEDIUM
    }
}

// MARK: - Engineering

data class EngineeringSignOff(
    val by: Int = 0,
    val byName: String = "",
    val at: String = ""
)

data class Engineering(
    val designed: EngineeringSignOff? = null,
    val verified: EngineeringSignOff? = null,
    val sentToPerforex: EngineeringSignOff? = null
)

enum class EngStep(val label: String, val index: Int) {
    DESIGNED("Designed", 0),
    VERIFIED("Verified", 1),
    SENT_TO_PERFOREX("Sent to Perforex", 2);

    companion object {
        fun fromIndex(i: Int) = entries.firstOrNull { it.index == i }
    }
}

// MARK: - Move Log

data class MoveLogEntry(
    val fromStart: String = "",
    val fromEnd: String = "",
    val toStart: String = "",
    val toEnd: String = "",
    val date: String = "",
    val movedBy: String = "",
    val reason: String? = null
)

// MARK: - Operation (Level 2)

data class Operation(
    val id: String = "",
    val title: String = "",
    val start: String = "",
    val end: String = "",
    val status: JobStatus = JobStatus.NOT_STARTED,
    val pri: Priority = Priority.MEDIUM,
    val team: List<Int> = emptyList(),
    val hpd: Double = 7.5,
    val notes: String = "",
    val deps: List<String> = emptyList(),
    val locked: Boolean? = null,
    val moveLog: List<MoveLogEntry>? = null,
    val pid: String? = null,
    val pendingFinish: Boolean? = null,
    val loggedHours: Double? = null
)

// MARK: - Panel (Level 1)

data class Panel(
    val id: String = "",
    val title: String = "",
    val start: String = "",
    val end: String = "",
    val status: JobStatus = JobStatus.NOT_STARTED,
    val pri: Priority = Priority.MEDIUM,
    val team: List<Int> = emptyList(),
    val hpd: Double = 7.5,
    val notes: String = "",
    val deps: List<String> = emptyList(),
    val engineering: Engineering? = null,
    val subs: List<Operation> = emptyList()
)

// MARK: - Job (Level 0) — named TRAQSJob to avoid conflict with kotlinx.coroutines.Job

data class TRAQSJob(
    val id: String = "",
    val title: String = "",
    val jobNumber: String? = null,
    val poNumber: String? = null,
    val start: String = "",
    val end: String = "",
    val dueDate: String? = null,
    val status: JobStatus = JobStatus.NOT_STARTED,
    val pri: Priority = Priority.MEDIUM,
    val team: List<Int> = emptyList(),
    val color: String = "#3d7fff",
    val hpd: Double = 7.5,
    val notes: String = "",
    val clientId: String? = null,
    val deps: List<String> = emptyList(),
    val subs: List<Panel> = emptyList(),
    val moveLog: List<MoveLogEntry>? = null,
    val jobType: String? = null,
    val loggedHours: Double? = null,
    val projectManagerId: String? = null
) {
    val displayNumber: String get() = jobNumber?.let { "#$it" } ?: ""
}

// MARK: - Timeclock

data class JobRef(
    val jobId: String = "",
    val panelId: String = "",
    val opId: String = ""
)

data class ActiveClockIn(
    val clockIn: String = "",
    val jobRefs: List<JobRef> = emptyList()
)

// Single in-progress job per person — separate from the payroll clock.
// Set by the job-card "Log Time" / "Stop" buttons; bearer-auth, no PIN.
data class ActiveJobClock(
    val clockIn: String = "",
    val jobId: String = "",
    val panelId: String? = null,
    val opId: String? = null,
    val jobTitle: String? = null,
    val panelTitle: String? = null,
    val opTitle: String? = null,
    val pausedAt: String? = null,
    val totalPausedMs: Double? = null
) {
    val isPaused: Boolean get() = pausedAt != null
}

// Lightweight on-break status. Job clock keeps running.
// durationMinutes is a snapshot of the configured break length used for
// the reminder and "time left" display — the break does NOT auto-end.
data class ActiveBreak(
    val startedAt: String = "",
    val durationMinutes: Int = 15
)

// Historical timeclock entry — read from timeclock.json. Some rows are
// punch-in/out pairs; others (with eventType set) are lunch/break markers.
data class TimeclockEntry(
    val id: String = "",
    val personId: String = "",
    val date: String? = null,
    val clockIn: String? = null,
    val clockOut: String? = null,
    val hours: Double? = null,
    val jobRefs: List<JobRef>? = null,
    val note: String? = null,
    val eventType: String? = null,
    val timestamp: String? = null
)

data class ClockEntry(
    val id: String = "",
    val personId: String = "",
    val date: String = "",
    val clockIn: String = "",
    val clockOut: String = "",
    val hours: Double = 0.0,
    val jobRefs: List<JobRef> = emptyList(),
    val note: String = ""
)

// MARK: - Admin Permissions

data class AdminPerms(
    val editJobs: Boolean = false,
    val moveJobs: Boolean = false,
    val reassign: Boolean = false,
    val lockJobs: Boolean = false,
    val manageTeam: Boolean = false,
    val manageClients: Boolean = false,
    val undoHistory: Boolean = false,
    val orgSettings: Boolean = false
)

// MARK: - Time Off

data class TimeOffEntry(
    val start: String = "",
    val end: String = "",
    val type: String = "PTO",
    val reason: String? = null
)

// MARK: - Person

data class Person(
    val id: Int = 0,
    val name: String = "Unknown",
    val role: String = "",
    val email: String = "",
    val cap: Double = 8.0,
    val color: String = "#7c3aed",
    val userRole: String = "user",
    val adminPerms: AdminPerms? = null,
    val isEngineer: Boolean? = null,
    val isTeamLead: Boolean? = null,
    val teamNumber: Int? = null,
    val autoSchedule: Boolean? = null,
    val timeOff: List<TimeOffEntry> = emptyList(),
    val pushToken: String? = null,
    val activeClockIn: ActiveClockIn? = null,
    val activeJobClock: ActiveJobClock? = null,
    val activeBreak: ActiveBreak? = null,
    val pin: String? = null
) {
    val isAdmin: Boolean get() = userRole == "admin"
}

// MARK: - Client

data class Client(
    val id: String = "",
    val name: String = "",
    val contact: String = "",
    val email: String = "",
    val phone: String = "",
    val color: String = "#3d7fff",
    val notes: String = ""
)

// MARK: - Attachment

data class Attachment(
    val key: String = "",
    val filename: String = "",
    val mimeType: String = "",
    val size: Int = 0
)

// MARK: - Message

data class Message(
    val id: String = "",
    val threadKey: String = "",
    val scope: String = "job",  // "job" | "panel" | "op" | "group"
    val jobId: String? = null,
    val panelId: String? = null,
    val opId: String? = null,
    val text: String = "",
    val authorId: Int = 0,
    val authorName: String = "",
    val authorColor: String = "#3d7fff",
    val participantIds: List<Int> = emptyList(),
    val attachments: List<Attachment> = emptyList(),
    val timestamp: String = ""
)

// MARK: - ChatGroup

data class ChatGroup(
    val id: String = "",
    val name: String = "",
    val memberIds: List<Int> = emptyList()
)

// MARK: - Notification Payload

data class NotifyPayload(
    val type: String = "step",
    val jobTitle: String = "",
    val jobNumber: String? = null,
    val panelTitle: String = "",
    val stepLabel: String = "",
    val jobTeamIds: List<Int> = emptyList(),
    val newTeamIds: List<Int> = emptyList(),
    val clientName: String? = null
)

// MARK: - Org Settings
// Mirrors the web's orgSettings shape (orgs/{code}/settings.json).

data class OrgBreak(
    val time: String = "12:00",
    val durationMinutes: Int = 30
)

data class OrgSettings(
    val hpd: Double = 8.0,
    val workStart: String = "07:00",
    val workEnd: String = "15:00",
    val workDays: List<Int> = listOf(1, 2, 3, 4, 5),
    val holidays: List<String> = emptyList(),
    val roles: List<String> = emptyList(),
    val approvalQueueLabel: String = "Approval Queue",
    val approvalSteps: List<String> = listOf("Review", "Approve", "Release"),
    val approverLabel: String = "Approver",
    val payDates: List<Int> = listOf(5, 20),
    val payMode: String = "setdate",
    val payAnchor: String? = null,
    val trackLunch: Boolean = false,
    val trackBreaks: Boolean = false,
    val payPeriodType: String = "biweekly",
    val payPeriodStart: String? = null,
    val breaks: List<OrgBreak> = listOf(OrgBreak("10:00", 15)),
    val lunch: OrgBreak = OrgBreak("12:00", 30)
) {
    companion object {
        val DEFAULT = OrgSettings()
    }
}

// MARK: - Org Info

data class OrgInfo(
    val name: String? = null,
    val domain: String? = null,
    val adminEmail: String? = null,
    val connection: String? = null
)

// MARK: - AI

data class AIRequest(
    val system: String,
    val messages: List<Map<String, String>>,
    val max_tokens: Int = 4096
)

data class AIResponseContent(
    val text: String? = null,
    val type: String = ""
)

data class AIResponse(
    val content: List<AIResponseContent> = emptyList()
)
