package com.matrixsystems.traqs.services

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.auth0.android.Auth0
import com.auth0.android.authentication.AuthenticationException
import com.auth0.android.callback.Callback
import com.auth0.android.provider.WebAuthProvider
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class AuthManager(private val context: Context) : ViewModel() {

    private val account = Auth0(AppConfig.Auth0.CLIENT_ID, AppConfig.Auth0.DOMAIN)

    private val _accessToken = MutableStateFlow<String?>(SecureStorage.load(context, SecureStorage.KEY_ACCESS_TOKEN))
    val accessToken: StateFlow<String?> = _accessToken.asStateFlow()

    private val _isAuthenticated = MutableStateFlow(_accessToken.value != null)
    val isAuthenticated: StateFlow<Boolean> = _isAuthenticated.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _userEmail = MutableStateFlow<String?>(SecureStorage.load(context, SecureStorage.KEY_USER_EMAIL))
    val userEmail: StateFlow<String?> = _userEmail.asStateFlow()

    fun login(activity: android.app.Activity) {
        _isLoading.value = true
        _error.value = null

        WebAuthProvider.login(account)
            .withScheme(AppConfig.Auth0.SCHEME)
            .withAudience(AppConfig.Auth0.AUDIENCE)
            .withScope(AppConfig.Auth0.SCOPE)
            .start(activity, object : Callback<com.auth0.android.result.Credentials, AuthenticationException> {
                override fun onSuccess(result: com.auth0.android.result.Credentials) {
                    val token = result.accessToken
                    _accessToken.value = token
                    _isAuthenticated.value = true
                    SecureStorage.save(context, SecureStorage.KEY_ACCESS_TOKEN, token)
                    result.refreshToken?.let {
                        SecureStorage.save(context, SecureStorage.KEY_REFRESH_TOKEN, it)
                    }
                    viewModelScope.launch {
                        fetchUserEmail(token)
                    }
                    _isLoading.value = false
                }

                override fun onFailure(error: AuthenticationException) {
                    if (!error.isCanceled) {
                        _error.value = error.message ?: "Login failed"
                    }
                    _isLoading.value = false
                }
            })
    }

    fun logout(activity: android.app.Activity) {
        WebAuthProvider.logout(account)
            .withScheme(AppConfig.Auth0.SCHEME)
            .start(activity, object : Callback<Void?, AuthenticationException> {
                override fun onSuccess(result: Void?) {
                    clearSession()
                }
                override fun onFailure(error: AuthenticationException) {
                    clearSession()
                }
            })
    }

    private fun clearSession() {
        _accessToken.value = null
        _isAuthenticated.value = false
        _userEmail.value = null
        SecureStorage.clear(context)
    }

    private suspend fun fetchUserEmail(token: String) = withContext(Dispatchers.IO) {
        try {
            val client = OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(10, TimeUnit.SECONDS)
                .build()
            val request = Request.Builder()
                .url("https://${AppConfig.Auth0.DOMAIN}/userinfo")
                .addHeader("Authorization", "Bearer $token")
                .build()
            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: return@withContext
            val json = JSONObject(body)
            val email = json.optString("email").takeIf { it.isNotEmpty() } ?: return@withContext
            _userEmail.value = email
            SecureStorage.save(context, SecureStorage.KEY_USER_EMAIL, email)
        } catch (_: Exception) {}
    }
}
