package com.matrixsystems.traqs.services

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.matrixsystems.traqs.models.ActiveBreak
import com.matrixsystems.traqs.models.ActiveJobClock
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
import java.text.SimpleDateFormat
import java.util.*

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
                val snap: Triple<Int, ActiveJobClock?, ActiveBreak?>? = run {
                    val pid = currentPersonId ?: return@run null
                    if (System.currentTimeMillis() - clockChangeAt >= 12_000) return@run null
                    val cur = _people.value.firstOrNull { it.id == pid } ?: return@run null
                    Triple(pid, cur.activeJobClock, cur.activeBreak)
                }
                val freshPeople = p.await()
                _people.value = if (snap != null) {
                    freshPeople.map { person ->
                        if (person.id == snap.first) person.copy(
                            activeJobClock = snap.second,
                            activeBreak = snap.third
                        ) else person
                    }
                } else freshPeople
                _clients.value = c.await()
                _messages.value = m.await()
                _unreadCount.value = maxOf(0, _messages.value.size - msgPrefs.getInt("last_seen_msg_count", 0))
                _groups.value = g.await()
                s.await()?.let { _orgSettings.value = it }
                autoMatchPerson()
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

    fun markMessagesRead() {
        val count = _messages.value.size
        msgPrefs.edit().putInt("last_seen_msg_count", count).apply()
        _unreadCount.value = 0
    }

    fun deleteThread(threadKey: String) {
        _messages.value = _messages.value.filter { it.threadKey != threadKey }
        viewModelScope.launch { runCatching { api?.deleteThread(threadKey) } }
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
