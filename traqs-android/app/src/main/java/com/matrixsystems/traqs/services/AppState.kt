package com.matrixsystems.traqs.services

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.matrixsystems.traqs.models.ActiveBreak
import com.matrixsystems.traqs.models.ActiveClockIn
import com.matrixsystems.traqs.models.ActiveJobClock
import com.matrixsystems.traqs.models.ClockEvent
import com.matrixsystems.traqs.models.Client
import com.matrixsystems.traqs.models.ChatGroup
import com.matrixsystems.traqs.models.EngStep
import com.matrixsystems.traqs.models.Engineering
import com.matrixsystems.traqs.models.EngineeringSignOff
import com.matrixsystems.traqs.models.Message
import com.matrixsystems.traqs.models.OrgSettings
import com.matrixsystems.traqs.models.Panel
import com.matrixsystems.traqs.models.Person
import com.matrixsystems.traqs.models.NotifyPayload
import com.matrixsystems.traqs.models.TRAQSJob
import com.google.gson.Gson
import com.matrixsystems.traqs.models.ClockEntry
import com.matrixsystems.traqs.models.TimeclockEntry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.coroutines.Job as CoroutineJob
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.supervisorScope
import java.text.SimpleDateFormat
import java.util.*

// The three live clock fields on the signed-in person, captured before a fetch
// overwrites `people` so an optimistic punch made moments ago survives it. The
// PAY clock belongs here as much as the other two: without it, clocking in and
// then hitting a refresh inside the grace window snapped the CTA back to
// "Clock In" until the server caught up.
private data class ClockSnapshot(
    val personId: Int,
    val jobClock: ActiveJobClock?,
    val activeBreak: ActiveBreak?,
    val payClock: ActiveClockIn?,
)

// Derived from the person's shift clock (activeClockIn plus its lunch/break
// events). Mirrors iOS ShiftStatus in Services/NavigationTypes.
enum class ShiftStatus(val label: String) {
    OFFLINE("Offline"),
    CLOCKED_IN("Clocked in"),
    LUNCH("Lunch"),
    ON_BREAK("Break");

    val dot: Boolean get() = this != OFFLINE
}

// Lunch milliseconds inside a shift's events. An open lunch is closed at `endMs`
// so someone still on lunch has that stretch excluded too. Breaks are PAID and
// deliberately absent — a 9h clocked window minus a 60min lunch is the 8h paid
// day. Mirrors pausedMsFromEvents in timeclock.js.
internal fun startOfDayMs(ms: Long): Long = Calendar.getInstance().apply {
    timeInMillis = ms
    set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
    set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
}.timeInMillis

internal fun lunchPausedMs(events: List<ClockEvent>, endMs: Long): Long {
    if (events.isEmpty()) return 0L
    var paused = 0L
    var lunchOpen: Long? = null
    for (ev in events) {
        val t = parseFlexibleISO(ev.ts) ?: continue
        when (ev.type) {
            "lunchStart" -> lunchOpen = t
            "lunchEnd" -> lunchOpen?.let { paused += maxOf(0L, t - it); lunchOpen = null }
        }
    }
    lunchOpen?.let { paused += maxOf(0L, endMs - it) }
    return paused
}

sealed class SaveStatus {
    object Idle : SaveStatus()
    object Saving : SaveStatus()
    object Saved : SaveStatus()
    data class Error(val message: String) : SaveStatus()
}

// Parse a wide variety of ISO8601 timestamps the server emits:
//   2024-01-15T08:30:00Z
//   2024-01-15T08:30:00.123Z
//   2024-01-15T08:30:00      (assume UTC)
//   2024-01-15T08:30:00-05:00
// Returns epoch millis (UTC), or null if unparseable.
fun parseFlexibleISO(s: String?): Long? {
    if (s.isNullOrEmpty()) return null
    val patterns = listOf(
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
        "yyyy-MM-dd'T'HH:mm:ssXXX",
        "yyyy-MM-dd'T'HH:mm:ss.SSS",
        "yyyy-MM-dd'T'HH:mm:ss",
    )
    for (p in patterns) {
        try {
            val f = SimpleDateFormat(p, Locale.US)
            // Patterns ending with literal 'Z' or no zone → treat as UTC.
            if (p.endsWith("'Z'") || !p.contains("XXX")) {
                f.timeZone = TimeZone.getTimeZone("UTC")
            }
            return f.parse(s)?.time
        } catch (_: Exception) { /* try next */ }
    }
    return null
}

class AppState(private val context: Context) : ViewModel() {

    // MARK: - Core Data
    private val _jobs = MutableStateFlow<List<TRAQSJob>>(emptyList())
    val jobs: StateFlow<List<TRAQSJob>> = _jobs.asStateFlow()

    private val _people = MutableStateFlow<List<Person>>(emptyList())
    val people: StateFlow<List<Person>> = _people.asStateFlow()

    private val _clients = MutableStateFlow<List<Client>>(emptyList())
    val clients: StateFlow<List<Client>> = _clients.asStateFlow()

    private val _messages = MutableStateFlow<List<Message>>(emptyList())
    val messages: StateFlow<List<Message>> = _messages.asStateFlow()

    private val _groups = MutableStateFlow<List<ChatGroup>>(emptyList())
    val groups: StateFlow<List<ChatGroup>> = _groups.asStateFlow()

    private val _timeclock = MutableStateFlow<List<ClockEntry>>(emptyList())
    val timeclock: StateFlow<List<ClockEntry>> = _timeclock.asStateFlow()

    // Org-level settings (hpd, workDays, pay period, breaks). Synced from
    // the web; defaults until first fetch.
    private val _orgSettings = MutableStateFlow(OrgSettings.DEFAULT)
    val orgSettings: StateFlow<OrgSettings> = _orgSettings.asStateFlow()

    // Historical timeclock entries (per-person, lifetime). Loaded on demand —
    // potentially large, so views call refreshTimeclock() when they need it.
    private val _timeclockEntries = MutableStateFlow<List<TimeclockEntry>>(emptyList())
    val timeclockEntries: StateFlow<List<TimeclockEntry>> = _timeclockEntries.asStateFlow()

    // Surfaced clock-related error (job clock failures, etc.).
    private val _clockError = MutableStateFlow<String?>(null)
    val clockError: StateFlow<String?> = _clockError.asStateFlow()

    // Timestamp of the last optimistic activeJobClock/activeBreak mutation.
    // loadAll() uses this to preserve the local value while the server's
    // eventual-consistency catches up (mirrors iOS clockChangeAt grace window).
    private var clockChangeAt: Long = 0L

    // MARK: - Unread messages
    private val msgPrefs = context.getSharedPreferences("traqs_msg_prefs", Context.MODE_PRIVATE)
    private val _unreadCount = MutableStateFlow(0)
    val unreadCount: StateFlow<Int> = _unreadCount.asStateFlow()

    // MARK: - UI State
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _saveStatus = MutableStateFlow<SaveStatus>(SaveStatus.Idle)
    val saveStatus: StateFlow<SaveStatus> = _saveStatus.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    // MARK: - Auth / Org
    var matchEmail: String? = null
    var currentPersonId: Int? = null
        private set

    private val _orgCode = MutableStateFlow(SecureStorage.load(context, SecureStorage.KEY_ORG_CODE) ?: "")
    val orgCode: StateFlow<String> = _orgCode.asStateFlow()

    // MARK: - Undo / Redo
    private val undoStack = ArrayDeque<List<TRAQSJob>>()
    private val redoStack = ArrayDeque<List<TRAQSJob>>()
    private val maxUndoSize = 50

    private var saveJob: CoroutineJob? = null
    private var refreshJob: CoroutineJob? = null
    private var api: ApiService? = null

    val canUndo: Boolean get() = undoStack.isNotEmpty()
    val canRedo: Boolean get() = redoStack.isNotEmpty()

    // MARK: - Setup

    fun configure(token: String, orgCode: String) {
        _orgCode.value = orgCode
        api = ApiService(token, orgCode)
        SecureStorage.save(context, SecureStorage.KEY_ORG_CODE, orgCode)
        startAutoRefresh()
    }

    fun startAutoRefresh() {
        refreshJob?.cancel()
        refreshJob = viewModelScope.launch {
            while (isActive) {
                delay(15_000)
                if (!_isLoading.value) loadAll()
            }
        }
    }

    fun stopAutoRefresh() {
        refreshJob?.cancel()
        refreshJob = null
    }

    // MARK: - Load

    fun loadAll() {
        viewModelScope.launch {
            val currentApi = api ?: return@launch
            _isLoading.value = true
            _errorMessage.value = null
            try {
                // supervisorScope, NOT the plain coroutineScope this `launch`
                // gives us. These six run concurrently, and under a regular scope
                // the FIRST one to fail cancels its siblings and propagates
                // straight to the parent job — past the try/catch below, which
                // only ever sees whichever await() is next in line. An expired
                // token makes all six 401 at once, so the app died on launch with
                // an uncaught HttpException instead of showing a load error.
                //
                // Under a supervisor, a failed child is inert until awaited: the
                // await() that throws is caught here, and the failures nobody
                // awaits are dropped rather than crashing the process.
                supervisorScope {
                val j = async { currentApi.fetchJobs() }
                val p = async { currentApi.fetchPeople() }
                val c = async { currentApi.fetchClients() }
                val m = async { currentApi.fetchMessages() }
                val g = async { currentApi.fetchGroups() }
                val s = async { runCatching { currentApi.fetchOrgSettings() }.getOrNull() }
                _jobs.value = j.await()
                // Capture optimistic clock state BEFORE overwriting people so a
                // fresh fetch can't blank out a clock change the user just made.
                // 12s grace window matches iOS clockChangeAt.
                val snap: ClockSnapshot? = run {
                    val pid = currentPersonId ?: return@run null
                    if (System.currentTimeMillis() - clockChangeAt >= 12_000) return@run null
                    val cur = _people.value.firstOrNull { it.id == pid } ?: return@run null
                    ClockSnapshot(pid, cur.activeJobClock, cur.activeBreak, cur.activeClockIn)
                }
                val freshPeople = p.await()
                _people.value = if (snap != null) {
                    freshPeople.map { person ->
                        if (person.id == snap.personId) person.copy(
                            activeJobClock = snap.jobClock,
                            activeBreak = snap.activeBreak,
                            activeClockIn = snap.payClock
                        ) else person
                    }
                } else freshPeople
                _clients.value = c.await()
                _messages.value = m.await()
                _unreadCount.value = maxOf(0, _messages.value.size - msgPrefs.getInt("last_seen_msg_count", 0))
                _groups.value = g.await()
                s.await()?.let { _orgSettings.value = it }
                autoMatchPerson()
                }
            } catch (e: Exception) {
                _errorMessage.value = e.message
            }
            _isLoading.value = false
        }
    }

    suspend fun refreshOrgSettings() {
        runCatching { api?.fetchOrgSettings() }.getOrNull()?.let { _orgSettings.value = it }
    }

    /// Refresh JUST the jobs list — used after a job clock mutation so we
    /// don't clobber the optimistic activeJobClock on the current person.
    private suspend fun refreshJobsQuietly() {
        val fresh = runCatching { api?.fetchJobs() }.getOrNull() ?: return
        if (fresh.isNotEmpty() || _jobs.value.isEmpty()) _jobs.value = fresh
    }

    fun refreshTimeclock(personId: Int? = null) {
        viewModelScope.launch {
            runCatching { api?.fetchTimeclock(personId) }.getOrNull()?.let {
                _timeclockEntries.value = it
            }
        }
    }

    // MARK: - Jobs

    fun updateJobs(newJobs: List<TRAQSJob>, pushUndo: Boolean = true) {
        if (pushUndo) {
            undoStack.addLast(_jobs.value)
            if (undoStack.size > maxUndoSize) undoStack.removeFirst()
            redoStack.clear()
        }
        _jobs.value = newJobs
        scheduleSave()
    }

    fun updateJob(job: TRAQSJob, sendNotification: Boolean = false, clientName: String? = null) {
        val existing = _jobs.value.firstOrNull { it.id == job.id }
        val updated = _jobs.value.toMutableList()
        val idx = updated.indexOfFirst { it.id == job.id }
        if (idx >= 0) updated[idx] = job else updated.add(job)
        updateJobs(updated)

        if (!sendNotification) return
        val api = api ?: return
        viewModelScope.launch {
            try {
                if (existing == null) {
                    // Brand new job — notify admins + full team
                    api.sendNotification(
                        NotifyPayload(
                            type = "new_job",
                            jobTitle = job.title,
                            jobNumber = job.jobNumber,
                            jobTeamIds = job.team,
                            clientName = clientName
                        )
                    )
                } else {
                    // Existing job — notify anyone newly added to the team
                    val newMembers = job.team.filter { it !in existing.team }
                    if (newMembers.isNotEmpty()) {
                        api.sendNotification(
                            NotifyPayload(
                                type = "assigned",
                                jobTitle = job.title,
                                jobNumber = job.jobNumber,
                                jobTeamIds = job.team,
                                newTeamIds = newMembers
                            )
                        )
                    }
                }
            } catch (_: Exception) { /* best-effort */ }
        }
    }

    fun deleteJob(id: String) {
        updateJobs(_jobs.value.filter { it.id != id })
    }

    // MARK: - Engineering Sign-Off

    fun signOff(jobId: String, panelId: String, step: EngStep, personId: Int, personName: String) {
        val jobList = _jobs.value.toMutableList()
        val jobIdx = jobList.indexOfFirst { it.id == jobId }
        if (jobIdx < 0) return
        val job = jobList[jobIdx]
        val panels = job.subs.toMutableList()
        val panelIdx = panels.indexOfFirst { it.id == panelId }
        if (panelIdx < 0) return
        val panel = panels[panelIdx]
        val eng = panel.engineering ?: Engineering()
        val signOff = EngineeringSignOff(
            by = personId, byName = personName,
            at = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
                .apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())
        )
        val updatedEng = when (step) {
            EngStep.DESIGNED -> eng.copy(designed = signOff)
            EngStep.VERIFIED -> eng.copy(verified = signOff)
            EngStep.SENT_TO_PERFOREX -> eng.copy(sentToPerforex = signOff)
        }
        panels[panelIdx] = panel.copy(engineering = updatedEng)
        jobList[jobIdx] = job.copy(subs = panels)
        updateJob(jobList[jobIdx])
    }

    fun revertSignOff(jobId: String, panelId: String, step: EngStep) {
        val jobList = _jobs.value.toMutableList()
        val jobIdx = jobList.indexOfFirst { it.id == jobId }
        if (jobIdx < 0) return
        val job = jobList[jobIdx]
        val panels = job.subs.toMutableList()
        val panelIdx = panels.indexOfFirst { it.id == panelId }
        if (panelIdx < 0) return
        val panel = panels[panelIdx]
        val eng = panel.engineering ?: return
        val updatedEng = when (step) {
            EngStep.DESIGNED -> eng.copy(designed = null)
            EngStep.VERIFIED -> eng.copy(verified = null)
            EngStep.SENT_TO_PERFOREX -> eng.copy(sentToPerforex = null)
        }
        panels[panelIdx] = panel.copy(engineering = updatedEng)
        jobList[jobIdx] = job.copy(subs = panels)
        updateJob(jobList[jobIdx])
    }

    // MARK: - People / Clients / Messages

    fun updatePeople(newPeople: List<Person>) {
        _people.value = newPeople
        viewModelScope.launch { runCatching { api?.savePeople(newPeople) } }
    }

    fun updateClients(newClients: List<Client>) {
        _clients.value = newClients
        viewModelScope.launch { runCatching { api?.saveClients(newClients) } }
    }

    fun sendMessage(message: Message) {
        _messages.value = _messages.value + message
        viewModelScope.launch { runCatching { api?.sendMessage(message) } }
    }

    fun refreshMessages() {
        viewModelScope.launch {
            runCatching { api?.fetchMessages() }.onSuccess { msgs ->
                if (msgs != null) {
                    _messages.value = msgs
                    _unreadCount.value = maxOf(0, msgs.size - msgPrefs.getInt("last_seen_msg_count", 0))
                }
            }
        }
    }

    // Unread messages grouped by sender, most first — for Home's Messages card.
    //
    // Derived from the same count watermark the badge uses, because that is all
    // this app has: there are no read receipts on Android yet (iOS reads
    // `message-reads`). So "unread" means the tail of the list past the last
    // count we saw, which is right while messages only ever get appended and
    // wrong the moment one is deleted. Good enough for a card that names who is
    // waiting on you; replace it when read receipts land.
    val unreadSenders: List<Triple<Int, String, Int>>
        get() {
            val seen = msgPrefs.getInt("last_seen_msg_count", 0)
            val fresh = _messages.value.drop(seen)
            if (fresh.isEmpty()) return emptyList()
            return fresh
                .filter { it.authorId != currentPersonId }
                .groupBy { it.authorId }
                .map { (id, msgs) -> Triple(id, msgs.first().authorName, msgs.size) }
                .sortedByDescending { it.third }
        }

    fun markMessagesRead() {
        val count = _messages.value.size
        msgPrefs.edit().putInt("last_seen_msg_count", count).apply()
        _unreadCount.value = 0
    }

    // MARK: - Per-thread read cursor
    //
    // iOS keeps a server-backed `threadReadAt` map; Android has no sync service
    // yet, so this is the local half of it — enough for the inbox badge to mean
    // "messages since you last opened this thread" instead of "how many messages
    // exist", which is what the row used to count.

    private val _threadReadAt = MutableStateFlow(loadThreadReadAt())
    val threadReadAt: StateFlow<Map<String, String>> = _threadReadAt.asStateFlow()

    private fun loadThreadReadAt(): Map<String, String> =
        runCatching {
            val raw = msgPrefs.getString("thread_read_at", null) ?: return emptyMap()
            @Suppress("UNCHECKED_CAST")
            Gson().fromJson(raw, Map::class.java) as Map<String, String>
        }.getOrDefault(emptyMap())

    /// Move this thread's cursor to its newest message.
    fun markThreadRead(threadKey: String) {
        val newest = _messages.value
            .filter { it.threadKey == threadKey }
            .maxOfOrNull { it.timestamp } ?: return
        if (_threadReadAt.value[threadKey] == newest) return
        val updated = _threadReadAt.value + (threadKey to newest)
        _threadReadAt.value = updated
        msgPrefs.edit().putString("thread_read_at", Gson().toJson(updated)).apply()
    }

    /// Messages in `threadKey` that arrived after the cursor and aren't mine.
    /// A thread never seen before counts as fully unread, matching iOS.
    fun unreadCount(threadKey: String, messages: List<Message>): Int {
        val cursor = _threadReadAt.value[threadKey]
        return messages.count { it.authorId != currentPersonId && (cursor == null || it.timestamp > cursor) }
    }

    fun deleteThread(threadKey: String) {
        _messages.value = _messages.value.filter { it.threadKey != threadKey }
        viewModelScope.launch { runCatching { api?.deleteThread(threadKey) } }
    }

    // MARK: - Chat groups
    //
    // Mirrors iOS AppState.createGroup / updateGroup. Both are optimistic: the
    // local array updates first so the inbox and thread header reflect the change
    // immediately, and the whole-array save runs after.

    /// Create a group and hand it back so navigation can target the real thread.
    /// Returns null only if there's no API session.
    suspend fun createGroup(name: String, memberIds: List<Int>): ChatGroup? {
        val api = api ?: return null
        val trimmed = name.trim()
        // Reuse an existing same-named group instead of creating a duplicate — but
        // only when a name was actually given. Unnamed groups all share the empty
        // name, so an unconditional check would fold every one of them into
        // whichever was created first.
        if (trimmed.isNotEmpty()) {
            _groups.value.firstOrNull { it.name == trimmed }?.let { return it }
        }
        // Stamp the creator, matching what the desktop writes — it's what decides
        // who may later rename the group.
        val group = ChatGroup(
            id = UUID.randomUUID().toString(),
            name = trimmed,
            memberIds = memberIds,
            createdBy = currentPersonId?.toString(),
            createdAt = isoNow()
        )
        val updated = _groups.value + group
        _groups.value = updated
        runCatching { api.saveGroups(updated) }
            .onFailure { _errorMessage.value = "Failed to create group: ${it.message}" }
        return group
    }

    /// Rename a group and/or REPLACE its roster (so it can remove people too).
    /// `name` may be empty, which means "title it after its members" — clearing the
    /// field is a supported edit, not a no-op.
    suspend fun updateGroup(id: String, name: String, memberIds: List<Int>) {
        val api = api ?: return
        val idx = _groups.value.indexOfFirst { it.id == id }
        if (idx < 0) return
        if (memberIds.isEmpty()) return   // a group with nobody in it isn't one
        val current = _groups.value[idx]
        val trimmed = name.trim()
        val renaming = current.name != trimmed
        val rosterChanged = current.memberIds.toSet() != memberIds.toSet()
        // Renaming and changing the roster are creator/admin actions.
        if ((renaming || rosterChanged) && !canAdministerGroup(current)) return
        val updated = _groups.value.toMutableList()
        updated[idx] = current.copy(name = trimmed, memberIds = memberIds)
        _groups.value = updated
        runCatching { api.saveGroups(updated) }
            .onFailure { _errorMessage.value = "Failed to update group: ${it.message}" }
    }

    /// Only the creator or an org admin may rename a group or change its roster.
    /// A group with no recorded creator (pre-dating the field) stays open to its
    /// members, which is how those threads behaved before.
    fun canAdministerGroup(group: ChatGroup): Boolean {
        if (currentPerson?.isAdmin == true) return true
        val owner = group.createdBy?.takeIf { it.isNotBlank() } ?: return true
        return owner == currentPersonId?.toString()
    }

    // MARK: - Undo / Redo

    fun undo() {
        if (undoStack.isEmpty()) return
        redoStack.addLast(_jobs.value)
        _jobs.value = undoStack.removeLast()
        scheduleSave()
    }

    fun redo() {
        if (redoStack.isEmpty()) return
        undoStack.addLast(_jobs.value)
        _jobs.value = redoStack.removeLast()
        scheduleSave()
    }

    // MARK: - Auto-save

    private fun scheduleSave() {
        saveJob?.cancel()
        _saveStatus.value = SaveStatus.Saving
        saveJob = viewModelScope.launch {
            delay(3_000)
            persistJobs()
        }
    }

    private suspend fun persistJobs() {
        val currentApi = api ?: return
        try {
            currentApi.saveJobs(_jobs.value)
            _saveStatus.value = SaveStatus.Saved
            delay(2_000)
            if (_saveStatus.value is SaveStatus.Saved) _saveStatus.value = SaveStatus.Idle
        } catch (e: Exception) {
            _saveStatus.value = SaveStatus.Error(e.message ?: "Save failed")
        }
    }

    // MARK: - Auto-match person

    fun autoMatchPerson() {
        val email = matchEmail ?: return
        currentPersonId = _people.value.firstOrNull { it.email.lowercase() == email.lowercase() }?.id
    }

    // MARK: - Computed

    val currentPerson: Person? get() = currentPersonId?.let { id -> _people.value.firstOrNull { it.id == id } }

    val engineeringQueue: List<Pair<TRAQSJob, Panel>> get() =
        _jobs.value.flatMap { job ->
            job.subs.mapNotNull { panel ->
                val e = panel.engineering
                val allDone = e?.designed != null && e.verified != null && e.sentToPerforex != null
                if (allDone) null else Pair(job, panel)
            }
        }

    fun clientForJob(job: TRAQSJob): Client? = job.clientId?.let { id -> _clients.value.firstOrNull { it.id == id } }

    fun person(id: Int): Person? = _people.value.firstOrNull { it.id == id }

    // MARK: - AI

    fun askAI(system: String, userMessage: String, onResult: (String) -> Unit, onError: (String) -> Unit) {
        viewModelScope.launch {
            try {
                val result = api?.askAI(system, userMessage) ?: throw Exception("Not configured")
                onResult(result)
            } catch (e: Exception) {
                onError(e.message ?: "AI error")
            }
        }
    }

    // MARK: - Timeclock (PIN-auth, no Bearer token)

    fun loadTimeclock() {
        viewModelScope.launch {
            try {
                val client = OkHttpClient.Builder()
                    .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
                    .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
                    .build()
                val request = Request.Builder()
                    .url("${AppConfig.NETLIFY_BASE}timeclock")
                    .addHeader("X-Org-Code", _orgCode.value)
                    .get()
                    .build()
                val response = withContext(Dispatchers.IO) { client.newCall(request).execute() }
                val body = response.body?.string() ?: "[]"
                val type = com.google.gson.reflect.TypeToken.getParameterized(List::class.java, ClockEntry::class.java).type
                val entries: List<ClockEntry> = Gson().fromJson(body, type) ?: emptyList()
                _timeclock.value = entries
            } catch (_: Exception) {}
        }
    }

    // MARK: - Job Clock (Bearer-only, no PIN; uses currentPersonId)

    val myActiveJobClock: ActiveJobClock? get() = currentPerson?.activeJobClock
    val myActiveBreak: ActiveBreak? get() = currentPerson?.activeBreak
    val isOnBreak: Boolean get() = myActiveBreak != null

    private fun setLocalPersonMutation(personId: Int, mutate: (Person) -> Person) {
        val list = _people.value
        val idx = list.indexOfFirst { it.id == personId }
        if (idx < 0) return
        val updated = list.toMutableList()
        updated[idx] = mutate(list[idx])
        _people.value = updated
        clockChangeAt = System.currentTimeMillis()
    }

    fun jobClockIn(
        jobId: String, panelId: String? = null, opId: String? = null,
        jobTitle: String? = null, panelTitle: String? = null, opTitle: String? = null
    ) {
        val currentApi = api ?: return
        val personId = currentPersonId ?: return
        viewModelScope.launch {
            try {
                currentApi.jobClockIn(personId, jobId, panelId, opId, jobTitle, panelTitle, opTitle)
                val optimistic = ActiveJobClock(
                    clockIn = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
                        .apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date()),
                    jobId = jobId, panelId = panelId, opId = opId,
                    jobTitle = jobTitle, panelTitle = panelTitle, opTitle = opTitle
                )
                setLocalPersonMutation(personId) { it.copy(activeJobClock = optimistic) }
                refreshJobsQuietly()
            } catch (e: Exception) {
                val msg = e.message ?: ""
                if (msg.contains("409")) {
                    loadAll()  // already clocked in server-side — sync
                } else {
                    _clockError.value = "Failed to start: $msg"
                }
            }
        }
    }

    /// Synchronous local clear — flips the UI from STOP back to LOG TIME
    /// instantly while the network call is in flight.
    fun markJobClockedOutLocally() {
        val personId = currentPersonId ?: return
        setLocalPersonMutation(personId) { it.copy(activeJobClock = null) }
    }

    fun jobClockOut() {
        val currentApi = api ?: return
        val personId = currentPersonId ?: return
        viewModelScope.launch {
            try {
                currentApi.jobClockOut(personId)
                markJobClockedOutLocally()
                refreshJobsQuietly()
            } catch (e: Exception) {
                val msg = e.message ?: ""
                if (msg.contains("409")) {
                    markJobClockedOutLocally()  // server says already out — align
                    refreshJobsQuietly()
                } else {
                    _clockError.value = msg
                }
            }
        }
    }

    fun clearClockError() { _clockError.value = null }

    // MARK: - Pay Clock (Bearer) — the PAYROLL shift, distinct from the job clock
    //
    // The job clock above measures work against a job; this measures the shift a
    // worker is paid for. The two are independent except at lunch, where the
    // server pauses the job clock for the duration (applyLunchJobPause in
    // timeclock.js) so job cost is not charged for unpaid time.

    // The open pay shift, read straight off `people` so the optimistic tap and
    // the server's truth reach every reader through one field.
    val myActiveClockIn: ActiveClockIn? get() = currentPerson?.activeClockIn
    val isClockedInForPay: Boolean get() = myActiveClockIn != null

    // True while the current shift is on lunch — its last lunch event is a start.
    val payOnLunch: Boolean get() = myActiveClockIn?.onLunch == true

    // Pay-clock hours credited to TODAY: completed punches that started today,
    // plus the live shift if it started today. A shift that crosses midnight is
    // credited to the day it STARTED, matching iOS hoursToday.
    fun hoursToday(now: Long = System.currentTimeMillis()): Double {
        val dayStart = startOfDayMs(now)
        val dayEnd = dayStart + 86_400_000L
        val completed = _timeclockEntries.value.fold(0.0) { acc, e ->
            if (e.eventType != null || e.clockIn == null || e.clockOut == null) return@fold acc
            val t = parseFlexibleISO(e.clockIn) ?: return@fold acc
            if (t in dayStart until dayEnd) acc + (e.hours ?: 0.0) else acc
        }
        val liveStart = myActiveClockIn?.clockIn?.let { parseFlexibleISO(it) }
        val live = if (liveStart != null && liveStart in dayStart until dayEnd) liveShiftHours(now) else 0.0
        return completed + live
    }

    // What the signed-in person's shift is doing right now. Mirrors iOS
    // AppState.myShiftStatus; Home and the Time Clock both render it.
    val myShiftStatus: ShiftStatus
        get() = when {
            myActiveClockIn == null -> ShiftStatus.OFFLINE
            payOnLunch -> ShiftStatus.LUNCH
            isOnBreak -> ShiftStatus.ON_BREAK
            else -> ShiftStatus.CLOCKED_IN
        }

    // Live hours on the OPEN pay shift, net of lunch — the number the server
    // will write when the punch closes (hoursElapsedMinusPauses in timeclock.js).
    //
    // Lives HERE, not on a screen, so there is ONE pay-hours implementation:
    // Home's shift hero and the Time Clock hero have to agree to the second, and
    // they cannot if each carries its own copy.
    fun liveShiftHours(now: Long = System.currentTimeMillis()): Double {
        val clock = myActiveClockIn ?: return 0.0
        val start = parseFlexibleISO(clock.clockIn) ?: return 0.0
        val net = (now - start) - lunchPausedMs(clock.events, now)
        return maxOf(0.0, net / 1000.0 / 3600.0)
    }

    // Worker permission gate. ABSENT means granted; only an explicit false
    // denies, matching the server's canClockIn(). Guards the IN direction only —
    // revoking access mid-shift must never strand someone on the clock.
    val canClockInOut: Boolean get() = currentPerson?.canClockInOut != false

    // Whether the pay clock CTA appears at all: the org opted in, the person is
    // hourly, and they hold clock-in permission. Mirrors iOS showPayClock.
    val showPayClock: Boolean
        get() = _orgSettings.value.iosPayClockEnabled &&
                !(currentPerson?.isSalary ?: false) &&
                canClockInOut

    // Clock-out is blocked while a job runs only when the dependency is
    // enforced — it is off, matching AppConfig on iOS and timeclock.js.
    val clockOutBlockedByJob: Boolean
        get() = AppConfig.ENFORCE_CLOCK_JOB_DEPENDENCY && currentPerson?.activeJobClock != null

    private val _isPayClocking = MutableStateFlow(false)
    val isPayClocking: StateFlow<Boolean> = _isPayClocking.asStateFlow()

    // Re-entrancy guard for the lunch toggle. Deliberately NOT _isPayClocking:
    // nothing renders this one, so Lunch, Break and Clock Out stay live while the
    // lunch request finishes behind the optimistic flip.
    private var lunchInFlight = false

    // Drop the 12s optimistic-clock grace window so the NEXT loadAll() keeps the
    // server's clock fields instead of restoring the local snapshot over them.
    //
    // Needed wherever the server has just confirmed a change whose full effect
    // is only known server-side. A lunch punch is the case that forces it: the
    // same write that records the event also pauses activeJobClock, and the
    // local snapshot has no pause in it — so without this the fetch we make to
    // GET that pause would throw it straight back out again, and the job timer
    // would keep ticking through lunch for up to 12 seconds.
    private fun dropClockGrace() { clockChangeAt = 0L }

    // A fresh formatter per call — SimpleDateFormat is not thread-safe and these
    // run from coroutines.
    private fun isoNow(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())

    // HTTP status behind a Retrofit failure, or null for a transport error. The
    // pay clock has to tell 400 / 401 / 403 / 409 apart, which the older clock
    // paths cannot do with their message.contains("409") check.
    private fun httpStatus(e: Exception): Int? = (e as? retrofit2.HttpException)?.code()

    // The server's own words for a failure — err() bodies are {"error": "…"}.
    // Worth reading: a 403 here is one of three different refusals (feature off,
    // salaried, no permission) and only the body says which.
    private fun serverMessage(e: Exception): String? = try {
        (e as? retrofit2.HttpException)?.response()?.errorBody()?.string()
            ?.let { Gson().fromJson(it, Map::class.java)?.get("error") as? String }
            ?.takeIf { it.isNotBlank() }
    } catch (_: Exception) { null }

    // Clock IN for pay. Optimistic — the CTA flips on this frame and the server
    // reconciles behind it. `onResult` reports whether it stuck, so a PIN dialog
    // can stay open on failure.
    fun payClockIn(pin: String? = null, onResult: (Boolean) -> Unit = {}) {
        val currentApi = api ?: return onResult(false)
        val personId = currentPersonId ?: return onResult(false)
        if (_isPayClocking.value) return onResult(false)
        if (!canClockInOut) {
            _clockError.value = "Your account does not have clock-in access"
            return onResult(false)
        }
        val previous = myActiveClockIn
        _isPayClocking.value = true
        setLocalPersonMutation(personId) {
            it.copy(activeClockIn = ActiveClockIn(clockIn = isoNow(), source = "android-app"))
        }
        viewModelScope.launch {
            try {
                currentApi.payClockIn(personId, pin)
                refreshTimeclock(personId)
                onResult(true)
            } catch (e: Exception) {
                if (httpStatus(e) == 409) {
                    // Already clocked in elsewhere (kiosk, another device). The
                    // shift is real, so keep it and pull the server's version —
                    // which means letting that version through, not the optimistic
                    // one we just invented.
                    dropClockGrace()
                    loadAll()
                    onResult(true)
                } else {
                    setLocalPersonMutation(personId) { it.copy(activeClockIn = previous) }
                    _clockError.value = when (httpStatus(e)) {
                        // A 401 carrying a PIN means the PIN was wrong, not that
                        // the session died — say the useful thing.
                        401 -> if (pin != null) "Invalid PIN. Please try again."
                               else "Your session expired. Sign in again."
                        400 -> serverMessage(e) ?: "PIN required."
                        403 -> serverMessage(e) ?: "Clock-in is not available for your account."
                        else -> "Failed to clock in: " + (serverMessage(e) ?: e.message ?: "unknown error")
                    }
                    onResult(false)
                }
            } finally {
                _isPayClocking.value = false
            }
        }
    }

    // Clock OUT for pay. Optimistic clear; 409 means the server already has the
    // shift closed, which is the state we were asking for anyway.
    fun payClockOut(pin: String? = null, onResult: (Boolean) -> Unit = {}) {
        val currentApi = api ?: return onResult(false)
        val personId = currentPersonId ?: return onResult(false)
        if (_isPayClocking.value) return onResult(false)
        if (clockOutBlockedByJob) {
            _clockError.value = "Log out of your job before clocking out."
            return onResult(false)
        }
        val previous = myActiveClockIn
        _isPayClocking.value = true
        setLocalPersonMutation(personId) { it.copy(activeClockIn = null) }
        viewModelScope.launch {
            try {
                currentApi.payClockOut(personId, pin)
                // The finished punch exists now — refresh the history so the
                // pay-period total includes it.
                refreshTimeclock(personId)
                onResult(true)
            } catch (e: Exception) {
                if (httpStatus(e) == 409) {
                    dropClockGrace()
                    loadAll()
                    refreshTimeclock(personId)
                    onResult(true)
                } else {
                    setLocalPersonMutation(personId) { it.copy(activeClockIn = previous) }
                    _clockError.value = when (httpStatus(e)) {
                        401 -> if (pin != null) "Invalid PIN. Please try again."
                               else "Your session expired. Sign in again."
                        400 -> serverMessage(e) ?: "PIN required."
                        else -> "Failed to clock out: " + (serverMessage(e) ?: e.message ?: "unknown error")
                    }
                    onResult(false)
                }
            } finally {
                _isPayClocking.value = false
            }
        }
    }

    // Start or end lunch on the open pay shift. Returns as soon as the LOCAL
    // state is right; the request goes out behind it, so the Lunch pill flips on
    // the first tap instead of waiting a round trip. A failure reverts the
    // optimistic event — that revert IS the error report.
    //
    // The job clock pauses and resumes with lunch, but the server does that in
    // the same write, so there is nothing to mirror here: the paused
    // activeJobClock arrives with the refresh below, and the elapsed maths
    // already honours pausedAt.
    fun payLunchToggle() {
        val currentApi = api ?: return
        val personId = currentPersonId ?: return
        if (lunchInFlight) return
        val clock = myActiveClockIn ?: return
        val starting = !clock.onLunch
        lunchInFlight = true
        val event = ClockEvent(type = if (starting) "lunchStart" else "lunchEnd", ts = isoNow())
        setLocalPersonMutation(personId) { p ->
            p.activeClockIn?.let { p.copy(activeClockIn = it.copy(events = it.events + event)) } ?: p
        }
        viewModelScope.launch {
            try {
                if (starting) currentApi.payLunchStart(personId) else currentApi.payLunchEnd(personId)
                // Pull the job clock's new paused/resumed state — the lunch punch
                // changed it server-side and nothing local reflects that yet. The
                // server is now strictly ahead of us, so its copy has to win.
                dropClockGrace()
                loadAll()
            } catch (e: Exception) {
                if (httpStatus(e) == 409) {
                    dropClockGrace()
                    loadAll()   // server already in the target state — align, no error
                } else {
                    setLocalPersonMutation(personId) { p ->
                        p.activeClockIn?.let { ac ->
                            val i = ac.events.indexOfLast { it.type == event.type }
                            if (i < 0) p
                            else p.copy(activeClockIn = ac.copy(
                                events = ac.events.toMutableList().apply { removeAt(i) }))
                        } ?: p
                    }
                    _clockError.value = "Failed to " + (if (starting) "start" else "end") + " lunch: " +
                        (serverMessage(e) ?: e.message ?: "unknown error")
                }
            } finally {
                lunchInFlight = false
            }
        }
    }

    // MARK: - Break (lightweight status; job clock keeps running)

    fun startBreak(onScheduleReminder: (Int) -> Unit = {}) {
        val currentApi = api ?: return
        val personId = currentPersonId ?: return
        val minutes = _orgSettings.value.breaks.firstOrNull()?.durationMinutes ?: 15
        val optimistic = ActiveBreak(
            startedAt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
                .apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date()),
            durationMinutes = minutes
        )
        setLocalPersonMutation(personId) { it.copy(activeBreak = optimistic) }
        onScheduleReminder(minutes)
        viewModelScope.launch {
            try {
                currentApi.breakBegin(personId, minutes)
                refreshJobsQuietly()
            } catch (e: Exception) {
                val msg = e.message ?: ""
                if (!msg.contains("409")) {
                    setLocalPersonMutation(personId) { it.copy(activeBreak = null) }
                    _clockError.value = msg
                } else {
                    refreshJobsQuietly()  // already on break server-side
                }
            }
        }
    }

    fun endBreak(onCancelReminder: () -> Unit = {}) {
        val currentApi = api ?: return
        val personId = currentPersonId ?: return
        val previous = myActiveBreak
        setLocalPersonMutation(personId) { it.copy(activeBreak = null) }
        onCancelReminder()
        viewModelScope.launch {
            try {
                currentApi.breakEnd(personId)
                refreshJobsQuietly()
            } catch (e: Exception) {
                val msg = e.message ?: ""
                if (!msg.contains("409")) {
                    setLocalPersonMutation(personId) { it.copy(activeBreak = previous) }
                    _clockError.value = msg
                } else {
                    refreshJobsQuietly()  // already cleared server-side
                }
            }
        }
    }

    // MARK: - Hours-weighted progress (mirrors iOS opHoursPair / opPct / panelPct / jobPct)

    /// (logged, est) for a single op. Logged is capped at est so an op can't
    /// push aggregate progress past 100%. Adds live elapsed time for whoever
    /// is currently clocked into the op so the bar creeps between polls.
    fun opHoursPair(op: com.matrixsystems.traqs.models.Operation): Pair<Double, Double> {
        val est = maxOf(0.0001, if (op.hpd > 0) op.hpd else _orgSettings.value.hpd)
        if (op.status == com.matrixsystems.traqs.models.JobStatus.FINISHED) return est to est
        if (op.pendingFinish == true) return (est * 0.99) to est
        val base = op.loggedHours ?: 0.0
        var live = 0.0
        val activeP = _people.value.firstOrNull {
            it.activeJobClock?.opId == op.id && !it.activeJobClock?.clockIn.isNullOrEmpty()
        }
        val jc = activeP?.activeJobClock
        if (jc != null) {
            val started = parseFlexibleISO(jc.clockIn)
            if (started != null) {
                val elapsedH = (System.currentTimeMillis() - started) / 3_600_000.0
                val pausedH = (jc.totalPausedMs ?: 0.0) / 3_600_000.0
                live = maxOf(0.0, elapsedH - pausedH)
            }
        }
        return minOf(est, base + live) to est
    }

    fun opPct(op: com.matrixsystems.traqs.models.Operation): Int {
        if (op.status == com.matrixsystems.traqs.models.JobStatus.FINISHED) return 100
        if (op.pendingFinish == true) return 99
        val (logged, est) = opHoursPair(op)
        if (logged == 0.0) return when (op.status) {
            com.matrixsystems.traqs.models.JobStatus.IN_PROGRESS -> 5
            com.matrixsystems.traqs.models.JobStatus.ON_HOLD -> 2
            else -> 0
        }
        return minOf(98, ((logged / est) * 100).toInt())
    }

    fun panelPct(panel: Panel): Int {
        val ops = panel.subs
        if (ops.isEmpty()) return if (panel.status == com.matrixsystems.traqs.models.JobStatus.FINISHED) 100 else 0
        var logged = 0.0; var est = 0.0
        ops.forEach { val (l, e) = opHoursPair(it); logged += l; est += e }
        if (est == 0.0) return 0
        return minOf(100, ((logged / est) * 100).toInt())
    }

    fun jobPct(job: TRAQSJob): Int {
        val ops = job.subs.flatMap { it.subs }
        if (ops.isEmpty()) return if (job.status == com.matrixsystems.traqs.models.JobStatus.FINISHED) 100 else 0
        var logged = 0.0; var est = 0.0
        ops.forEach { val (l, e) = opHoursPair(it); logged += l; est += e }
        if (est == 0.0) return 0
        return minOf(100, ((logged / est) * 100).toInt())
    }

    suspend fun timeclockPost(body: Map<String, Any>): Map<String, Any> {
        return withContext(Dispatchers.IO) {
            val gson = Gson()
            val client = OkHttpClient.Builder()
                .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
                .build()
            val json = gson.toJson(body)
            val requestBody = json.toRequestBody("application/json".toMediaType())
            val request = Request.Builder()
                .url("${AppConfig.NETLIFY_BASE}timeclock")
                .addHeader("X-Org-Code", _orgCode.value)
                .post(requestBody)
                .build()
            val response = client.newCall(request).execute()
            val responseBody = response.body?.string() ?: "{}"
            @Suppress("UNCHECKED_CAST")
            gson.fromJson(responseBody, Map::class.java) as Map<String, Any>
        }
    }
}
