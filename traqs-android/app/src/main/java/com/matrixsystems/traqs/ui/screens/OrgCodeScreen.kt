package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.services.ApiService
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.services.AuthManager
import com.matrixsystems.traqs.ui.theme.traQSColors
import kotlinx.coroutines.launch

@Composable
fun OrgCodeScreen(
    authManager: AuthManager,
    appState: AppState,
    onSuccess: () -> Unit,
    onSignOut: () -> Unit
) {
    val c = traQSColors
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    var isChecking by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val token by authManager.accessToken.collectAsState()

    fun submit() {
        val upper = code.trim().uppercase()
        if (upper.isEmpty()) return
        isChecking = true
        error = null
        scope.launch {
            try {
                ApiService.lookupOrg(upper) // throws if not found
                val tok = token ?: throw Exception("No auth token — sign out and back in")
                appState.matchEmail = authManager.userEmail.value
                appState.configure(tok, upper)
                appState.loadAll()
                onSuccess()
            } catch (e: Exception) {
                error = e.message ?: "Unknown error"
            }
            isChecking = false
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(c.bg)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.weight(1f))

            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text("Enter Org Code", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = c.text)
                Text(
                    "Enter your organization's TRAQS code to continue.",
                    fontSize = 14.sp, color = c.muted, textAlign = TextAlign.Center
                )
            }

            Spacer(Modifier.height(32.dp))

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                TextField(
                    value = code,
                    onValueChange = { code = it.uppercase() },
                    placeholder = { Text("Org Code", color = c.muted) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Characters,
                        imeAction = ImeAction.Go
                    ),
                    keyboardActions = KeyboardActions(onGo = { submit() }),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = c.surface,
                        unfocusedContainerColor = c.surface,
                        focusedTextColor = c.text,
                        unfocusedTextColor = c.text,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .border(1.dp, c.border, RoundedCornerShape(12.dp)),
                    shape = RoundedCornerShape(12.dp)
                )

                error?.let {
                    Text(it, fontSize = 12.sp, color = c.danger)
                }

                Button(
                    onClick = { submit() },
                    enabled = code.isNotBlank() && !isChecking,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = c.accent)
                ) {
                    if (isChecking) {
                        CircularProgressIndicator(color = Color.White, modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
                    } else {
                        Text("Continue", fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = Color.White)
                    }
                }
            }

            Spacer(Modifier.weight(1f))

            TextButton(
                onClick = onSignOut,
                modifier = Modifier.padding(bottom = 24.dp)
            ) {
                Text("Sign Out", color = c.muted, fontSize = 12.sp)
            }
        }
    }
}
