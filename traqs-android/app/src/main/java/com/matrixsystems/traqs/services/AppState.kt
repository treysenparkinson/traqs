package com.matrixsystems.traqs.services

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.matrixsystems.traqs.models.Client
import com.matrixsystems.traqs.models.ChatGroup
import com.matrixsystems.traqs.models.EngStep
import com.matrixsystems.traqs.models.Engineering
import com.matrixsystems.traqs.models.EngineeringSignOff
import com.matrixsystems.traqs.models.Message
import com.matrixsystems.traqs.models.Panel
import com.matrixsystems.traqs.models.Person
import com.matrixsystems.traqs.models.NotifyPayload
import com.matrixsystems.traqs.models.TRAQSJob
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
                _jobs.value = j.await()
                _people.value = p.await()
                _clients.value = c.await()
                _messages.value = m.await()
                _unreadCount.value = maxOf(0, _messages.value.size - msgPrefs.getInt("last_seen_msg_count", 0))
                _groups.value = g.await()
                autoMatchPerson()
            } catch (e: Exception) {
                _errorMessage.value = e.message
            }
            _isLoading.value = false
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
}
