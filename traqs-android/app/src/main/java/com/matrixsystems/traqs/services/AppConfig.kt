package com.matrixsystems.traqs.services

object AppConfig {
    const val NETLIFY_BASE = "https://traqs.netlify.app/.netlify/functions/"

    // Mirrors ENFORCE_CLOCK_JOB_DEPENDENCY in timeclock.js and
    // AppConfig.enforceClockJobDependency on iOS: the "must be clocked in to
    // work a job" / "can't clock out while on a job" rules. DISABLED — flip all
    // three together to re-enable.
    const val ENFORCE_CLOCK_JOB_DEPENDENCY = false

    object Auth0 {
        const val DOMAIN = "matrixpci.us.auth0.com"
        const val CLIENT_ID = "xnuXY9QAr8VaB7so8DfBHydUgTgKbGtt"
        const val AUDIENCE = "https://traqs.matrixsystems.com/api"
        const val SCHEME = "traqs"
        const val SCOPE = "openid profile email offline_access"
        // Full callback: traqs://matrixpci.us.auth0.com/android/com.matrixsystems.traqs/callback
        // Add this to Auth0 dashboard → Applications → Allowed Callback URLs
    }

    object OneSignal {
        const val APP_ID = "e254cf4f-9233-4df6-93c2-568bfa57d61e"
    }
}
