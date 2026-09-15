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

// One lunch/break punch inside an open pay shift. The server appends these to
// activeClockIn.events; net-of-lunch pay hours are computed from them at
// clock-out. A lunchStart also pauses the job clock server-side.
data class ClockEvent(
    val type: String = "",   // "lunchStart" | "lunchEnd" | "breakStart" | "breakEnd"
    val ts: String = ""      // ISO8601
)

data class ActiveClockIn(
    val clockIn: String = "",
    val jobRefs: List<JobRef> = emptyList(),
    val events: List<ClockEvent> = emptyList(),
    val source: String? = null   // "kiosk" | "ios-app" | "android-app"
) {
    // True when the last lunch event on this shift is a start — i.e. the worker
    // is on lunch right now. Mirrors iOS AppState.payOnLunch.
    val onLunch: Boolean
        get() = events.lastOrNull { it.type == "lunchStart" || it.type == "lunchEnd" }?.type == "lunchStart"
}

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
    val pin: String? = null,
    // Optional profile picture as a data: URL / base64, same shape as iOS
    // Person.image. Rendered by Avatar; absent falls back to initials.
    val image: String? = null,
    // The server strips `pin` from people.json for everyone but admins and sends
    // this flag instead, so `pin` is the WRONG field to test for "is this person
    // PIN-gated" — for an ordinary worker it is always null. Read hasPin.
    val hasPin: Boolean? = null,
    // "hourly" (default) | "salary" — salaried people never punch the pay clock.
    val payType: String? = null,
    // Per-person worker permission set on the desktop. ABSENT means granted —
    // only an explicit false denies, mirroring the server's canClockIn().
    val canClockInOut: Boolean? = null
) {
    val isAdmin: Boolean get() = userRole == "admin"
    val isSalary: Boolean get() = (payType ?: "hourly").lowercase() == "salary"
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
    val memberIds: List<Int> = emptyList(),
    // Who created the group, and when. The desktop writes both on every group it
    // creates, and saveGroups is a whole-array replace the server stores verbatim
    // (no field-level merge) — so a group edited from a client that doesn't decode
    // these comes back with its creator stripped. Carried here so the round-trip is
    // lossless AND so "only the creator or an admin may rename" has something to
    // check. String, not Int: person ids are mixed string/number across the web app
    // and Gson coerces a JSON number into a String losslessly, where the app's
    // SafeIntDeserializer would flatten a string id to 0.
    val createdBy: String? = null,
    val createdAt: String? = null
) {
    /// What to show for this group ANYWHERE — thread list, thread header, pickers.
    /// Naming is optional and the web has historically created groups with no
    /// `name` at all, so reading `name` directly renders blank for most groups and
    /// callers that fell back to the thread key showed a raw UUID.
    fun displayName(people: List<Person>, myId: Int?): String {
        val trimmed = name.trim()
        if (trimmed.isNotEmpty()) return trimmed
        return memberNamesLine(memberIds, people, myId)
    }

    companion object {
        /// "Alice, Bob, Carol +4" — first names, in `memberIds` order, viewer
        /// excluded. Order follows memberIds rather than being sorted so a group's
        /// title stays put instead of reshuffling when somebody is renamed. Capped
        /// at three because the untruncated line runs wider than a thread row.
        fun memberNamesLine(memberIds: List<Int>, people: List<Person>, myId: Int?): String {
            val names = memberIds
                .filter { it != myId }
                .mapNotNull { id -> people.firstOrNull { it.id == id }?.name?.split(" ")?.firstOrNull() }
                .filter { it.isNotBlank() }
            if (names.isEmpty()) return "Group"
            if (names.size <= 3) return names.joinToString(", ")
            return names.take(3).joinToString(", ") + " +${names.size - 3}"
        }
    }
}

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
    // Soft cap of pay-clock hours per pay period; anything over reads as overtime.
    val payPeriodHourCap: Double = 80.0,
    // Admin opt-in for the in-app pay clock-in/out CTA. Default off — the server
    // refuses payClockIn unless this is true, so the UI must not offer it either.
    val iosPayClockEnabled: Boolean = false,
    val breaks: List<OrgBreak> = listOf(OrgBreak("10:00", 15)),
    val lunch: OrgBreak = OrgBreak("12:00", 30)
) {
    // PAID hours in a standard day: the scheduled shift block minus the unpaid
    // lunch, breaks left in because they are paid.
    //
    // NOT `hpd` — that is a scheduling capacity number that ignores lunch, so a
    // 07:00–16:00 shop with a 1h lunch reads 9 there but should target 8 here.
    val paidHoursPerDay: Double
        get() {
            fun minutes(t: String): Int? {
                val p = t.split(":").mapNotNull { it.toIntOrNull() }
                return if (p.size == 2) p[0] * 60 + p[1] else null
            }
            val s = minutes(workStart) ?: return 8.0
            val e = minutes(workEnd) ?: return 8.0
            if (e <= s) return 8.0
            val paid = (e - s) - maxOf(0, lunch.durationMinutes)
            return if (paid > 0) paid / 60.0 else 8.0
        }

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
