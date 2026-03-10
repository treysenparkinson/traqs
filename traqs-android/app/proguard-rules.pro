# Auth0
-keep class com.auth0.** { *; }
# Retrofit / OkHttp
-keep class retrofit2.** { *; }
-keep class okhttp3.** { *; }
# Gson
-keep class com.google.gson.** { *; }
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
# TRAQS models
-keep class com.matrixsystems.traqs.models.** { *; }
