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
    val pid: String? = null
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

// MARK: - Job (Level 0)

data class Job(
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
    val jobType: String? = null
) {
    val displayNumber: String get() = jobNumber?.let { "#$it" } ?: ""
}

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
    val timeOff: List<TimeOffEntry> = emptyList(),
    val pushToken: String? = null
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
    val jobTeamIds: List<Int> = emptyList()
)

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
