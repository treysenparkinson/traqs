package com.matrixsystems.traqs.services

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

object SecureStorage {
    private const val PREFS_FILE = "traqs_secure_prefs"
    const val KEY_ACCESS_TOKEN = "access_token"
    const val KEY_REFRESH_TOKEN = "refresh_token"
    const val KEY_USER_EMAIL = "user_email"
    const val KEY_ORG_CODE = "org_code"

    private fun getPrefs(context: Context) = EncryptedSharedPreferences.create(
        context,
        PREFS_FILE,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun save(context: Context, key: String, value: String) {
        getPrefs(context).edit().putString(key, value).apply()
    }

    fun load(context: Context, key: String): String? =
        getPrefs(context).getString(key, null)

    fun delete(context: Context, key: String) {
        getPrefs(context).edit().remove(key).apply()
    }

    fun clear(context: Context) {
        getPrefs(context).edit().clear().apply()
    }
}
