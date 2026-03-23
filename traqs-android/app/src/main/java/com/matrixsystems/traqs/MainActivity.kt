package com.matrixsystems.traqs

import android.content.Intent
import com.auth0.android.provider.WebAuthProvider
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {

    // Auth0 requires this for singleTask activities — passes the callback URL back to the SDK
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        WebAuthProvider.resume(intent)
    }
}
