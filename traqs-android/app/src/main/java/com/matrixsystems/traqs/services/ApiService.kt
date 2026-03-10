package com.matrixsystems.traqs.services

import com.matrixsystems.traqs.models.*
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.*

interface TRAQSApi {
    @GET("tasks")
    suspend fun fetchJobs(): List<Job>

    @POST("tasks")
    suspend fun saveJobs(@Body jobs: List<Job>)

    @GET("people")
    suspend fun fetchPeople(): List<Person>

    @POST("people")
    suspend fun savePeople(@Body people: List<Person>)

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
}

class ApiService(private val token: String, private val orgCode: String) {

    private val api: TRAQSApi by lazy {
        val logging = HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC }
        val client = OkHttpClient.Builder()
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
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(TRAQSApi::class.java)
    }

    suspend fun fetchJobs() = api.fetchJobs()
    suspend fun saveJobs(jobs: List<Job>) = api.saveJobs(jobs)
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

    companion object {
        suspend fun lookupOrg(code: String): OrgInfo {
            val client = OkHttpClient.Builder().build()
            val request = okhttp3.Request.Builder()
                .url("${AppConfig.NETLIFY_BASE}org?code=$code")
                .build()
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) throw Exception("Org not found (${response.code})")
            val body = response.body?.string() ?: throw Exception("Empty response")
            return com.google.gson.Gson().fromJson(body, OrgInfo::class.java)
        }
    }
}
