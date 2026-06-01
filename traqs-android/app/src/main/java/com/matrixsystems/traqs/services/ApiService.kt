package com.matrixsystems.traqs.services

import com.google.gson.GsonBuilder
import com.google.gson.JsonDeserializationContext
import com.google.gson.JsonDeserializer
import com.google.gson.JsonElement
import com.matrixsystems.traqs.models.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.*
import java.lang.reflect.Type
import java.util.concurrent.TimeUnit

// Tolerant Int deserializer — returns 0 for any value that can't be parsed as Int
// Prevents crashes when the API returns string IDs in fields declared as Int/List<Int>
private object SafeIntDeserializer : JsonDeserializer<Int> {
    override fun deserialize(json: JsonElement, type: Type, ctx: JsonDeserializationContext): Int =
        try { json.asInt } catch (_: Exception) { 0 }
}

private val lenientGson = GsonBuilder()
    .registerTypeAdapter(Int::class.javaObjectType, SafeIntDeserializer) // List<Int> uses boxed Integer
    .registerTypeAdapter(Int::class.java, SafeIntDeserializer)           // standalone Int fields
    .create()

interface TRAQSApi {
    @GET("tasks")
    suspend fun fetchJobs(): List<TRAQSJob>

    @POST("tasks")
    suspend fun saveJobs(@Body jobs: List<TRAQSJob>)

    @GET("people")
    suspend fun fetchPeople(): List<Person>

    @POST("people")
    suspend fun savePeople(@Body people: List<Person>)

    @PATCH("people")
    suspend fun patchPerson(@Body body: Map<String, @JvmSuppressWildcards Any>)

    @GET("clients")
    suspend fun fetchClients(): List<Client>

    @POST("clients")
    suspend fun saveClients(@Body clients: List<Client>)

    @GET("messages")
    suspend fun fetchMessages(): List<Message>

    @POST("messages")
    suspend fun sendMessage(@Body message: Message)

    @DELETE("messages")
    suspend fun deleteThread(@Query("threadKey") threadKey: String)

    @GET("groups")
    suspend fun fetchGroups(): List<ChatGroup>

    @POST("groups")
    suspend fun saveGroups(@Body groups: List<ChatGroup>)

    @POST("notify")
    suspend fun sendNotification(@Body payload: NotifyPayload)

    @POST("ai-schedule")
    suspend fun askAI(@Body request: AIRequest): AIResponse

    @GET("settings")
    suspend fun fetchOrgSettings(): OrgSettings

    @POST("settings")
    suspend fun saveOrgSettings(@Body settings: OrgSettings)

    @GET("timeclock")
    suspend fun fetchTimeclock(@Query("personId") personId: String? = null): List<TimeclockEntry>

    @POST("timeclock")
    suspend fun timeclockAction(@Body body: Map<String, @JvmSuppressWildcards Any>)
}

class ApiService(private val token: String, private val orgCode: String) {

    private val api: TRAQSApi by lazy {
        val logging = HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC }
        val client = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val req = chain.request().newBuilder()
                    .addHeader("Authorization", "Bearer $token")
                    .addHeader("X-Org-Code", orgCode)
                    .build()
                chain.proceed(req)
            }
            .addInterceptor(logging)
            .build()

        Retrofit.Builder()
            .baseUrl(AppConfig.NETLIFY_BASE)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create(lenientGson))
            .build()
            .create(TRAQSApi::class.java)
    }

    suspend fun fetchJobs() = api.fetchJobs()
    suspend fun saveJobs(jobs: List<TRAQSJob>) = api.saveJobs(jobs)
    suspend fun fetchPeople() = api.fetchPeople()
    suspend fun savePeople(people: List<Person>) = api.savePeople(people)
    suspend fun fetchClients() = api.fetchClients()
    suspend fun saveClients(clients: List<Client>) = api.saveClients(clients)
    suspend fun fetchMessages() = api.fetchMessages()
    suspend fun sendMessage(message: Message) = api.sendMessage(message)
    suspend fun deleteThread(threadKey: String) = api.deleteThread(threadKey)
    suspend fun fetchGroups() = api.fetchGroups()
    suspend fun saveGroups(groups: List<ChatGroup>) = api.saveGroups(groups)
    suspend fun sendNotification(payload: NotifyPayload) = api.sendNotification(payload)
    suspend fun askAI(system: String, userMessage: String): String {
        val request = AIRequest(
            system = system,
            messages = listOf(mapOf("role" to "user", "content" to userMessage))
        )
        val response = api.askAI(request)
        return response.content.mapNotNull { it.text }.joinToString("")
    }

    // MARK: - Org Settings
    suspend fun fetchOrgSettings(): OrgSettings = api.fetchOrgSettings()

    // MARK: - Timeclock history
    suspend fun fetchTimeclock(personId: Int? = null): List<TimeclockEntry> =
        api.fetchTimeclock(personId?.toString())

    // MARK: - Person PATCH (granular field updates — avoids savePeople race)
    suspend fun patchPerson(personId: Int, fields: Map<String, Any>) {
        api.patchPerson(mapOf("personId" to personId, "fields" to fields))
    }

    // MARK: - Job Clock (Bearer-only, no PIN — uses currentPersonId)
    suspend fun jobClockIn(
        personId: Int, jobId: String,
        panelId: String? = null, opId: String? = null,
        jobTitle: String? = null, panelTitle: String? = null, opTitle: String? = null
    ) {
        val body = linkedMapOf<String, Any>(
            "action" to "jobClockIn",
            "personId" to personId,
            "jobId" to jobId
        )
        panelId?.let { body["panelId"] = it }
        opId?.let { body["opId"] = it }
        jobTitle?.let { body["jobTitle"] = it }
        panelTitle?.let { body["panelTitle"] = it }
        opTitle?.let { body["opTitle"] = it }
        api.timeclockAction(body)
    }

    suspend fun jobClockOut(personId: Int) {
        api.timeclockAction(mapOf("action" to "jobClockOut", "personId" to personId))
    }

    // MARK: - Break (Bearer-only, lightweight status — job clock keeps running)
    suspend fun breakBegin(personId: Int, durationMinutes: Int) {
        api.timeclockAction(mapOf(
            "action" to "breakBegin",
            "personId" to personId,
            "durationMinutes" to durationMinutes
        ))
    }

    suspend fun breakEnd(personId: Int) {
        // Server action is "breakClear" — distinct from the PIN-kiosk "breakEnd".
        api.timeclockAction(mapOf("action" to "breakClear", "personId" to personId))
    }

    companion object {
        suspend fun lookupOrg(code: String): OrgInfo = withContext(Dispatchers.IO) {
            val client = OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .build()
            val request = okhttp3.Request.Builder()
                .url("${AppConfig.NETLIFY_BASE}org?code=$code")
                .build()
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) throw Exception("Org not found (${response.code})")
            val body = response.body?.string() ?: throw Exception("Empty response")
            lenientGson.fromJson(body, OrgInfo::class.java)
        }
    }
}
