package com.matrixsystems.traqs.services

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.matrixsystems.traqs.models.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
    private val _jobs = MutableStateFlow<List<Job>>(emptyList())
    val jobs: StateFlow<List<Job>> = _jobs.asStateFlow()

    private val _people = MutableStateFlow<List<Person>>(emptyList())
    val people: StateFlow<List<Person>> = _people.asStateFlow()

    private val _clients = MutableStateFlow<List<Client>>(emptyList())
    val clients: StateFlow<List<Client>> = _clients.asStateFlow()

    private val _messages = MutableStateFlow<List<Message>>(emptyList())
    val messages: StateFlow<List<Message>> = _messages.asStateFlow()

    private val _groups = MutableStateFlow<List<ChatGroup>>(emptyList())
    val groups: StateFlow<List<ChatGroup>> = _groups.asStateFlow()

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
    private val undoStack = ArrayDeque<List<Job>>()
    private val redoStack = ArrayDeque<List<Job>>()
    private val maxUndoSize = 50

    // MARK: - Auto-save / Auto-refresh
    private var saveJob: Job? = null
    private var refreshJob: kotlinx.coroutines.Job? = null
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
                if (!_isLoading.value) {
                    loadAll()
                }
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
                val jobsDeferred = async { currentApi.fetchJobs() }
                val peopleDeferred = async { currentApi.fetchPeople() }
                val clientsDeferred = async { currentApi.fetchClients() }
                val messagesDeferred = async { currentApi.fetchMessages() }
                val groupsDeferred = async { currentApi.fetchGroups() }

                _jobs.value = jobsDeferred.await()
                _people.value = peopleDeferred.await()
                _clients.value = clientsDeferred.await()
                _messages.value = messagesDeferred.await()
                _groups.value = groupsDeferred.await()
                autoMatchPerson()
            } catch (e: Exception) {
                _errorMessage.value = e.message
            }
            _isLoading.value = false
        }
    }

    // MARK: - Jobs

    fun updateJobs(newJobs: List<Job>, pushUndo: Boolean = true) {
        if (pushUndo) {
            undoStack.addLast(_jobs.value)
            if (undoStack.size > maxUndoSize) undoStack.removeFirst()
            redoStack.clear()
        }
        _jobs.value = newJobs
        scheduleSave()
    }

    fun updateJob(job: Job) {
        val updated = _jobs.value.toMutableList()
        val idx = updated.indexOfFirst { it.id == job.id }
        if (idx >= 0) updated[idx] = job else updated.add(job)
        updateJobs(updated)
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
            by = personId,
            byName = personName,
            at = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())
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

    // MARK: - People

    fun updatePeople(newPeople: List<Person>) {
        _people.value = newPeople
        viewModelScope.launch { runCatching { api?.savePeople(newPeople) } }
    }

    // MARK: - Clients

    fun updateClients(newClients: List<Client>) {
        _clients.value = newClients
        viewModelScope.launch { runCatching { api?.saveClients(newClients) } }
    }

    // MARK: - Messages

    fun sendMessage(message: Message) {
        _messages.value = _messages.value + message
        viewModelScope.launch { runCatching { api?.sendMessage(message) } }
    }

    fun refreshMessages() {
        viewModelScope.launch {
            runCatching { api?.fetchMessages() }
                .onSuccess { msgs -> if (msgs != null) _messages.value = msgs }
        }
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

    // MARK: - Auto-match person by email

    fun autoMatchPerson() {
        val email = matchEmail ?: return
        val match = _people.value.firstOrNull { it.email.lowercase() == email.lowercase() }
        currentPersonId = match?.id
    }

    // MARK: - Computed

    val currentPerson: Person? get() = currentPersonId?.let { id -> _people.value.firstOrNull { it.id == id } }

    val engineeringQueue: List<Pair<Job, Panel>> get() = _jobs.value.flatMap { job ->
        job.subs.mapNotNull { panel ->
            val e = panel.engineering
            val allDone = e?.designed != null && e.verified != null && e.sentToPerforex != null
            if (allDone) null else Pair(job, panel)
        }
    }

    fun clientForJob(job: Job): Client? = job.clientId?.let { id -> _clients.value.firstOrNull { it.id == id } }

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
