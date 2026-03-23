plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

android {
    namespace = "com.matrixsystems.traqs"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.matrixsystems.traqs"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["auth0Scheme"] = "traqs"
        manifestPlaceholders["auth0Domain"] = "matrixpci.us.auth0.com"
    }

    signingConfigs {
        create("release") {
            storeFile = file("C:/Users/treysen/traqs-release.jks")
            storePassword = "Traqs@feb2026!"
            keyAlias = "traqs-key"
            keyPassword = "Traqs@feb2026!"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    kotlinOptions {
        jvmTarget = "21"
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    aaptOptions {
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~"
    }

    // For Kotlin 1.9.x, Compose compiler version is set here (not via plugin)
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }
}

repositories {
    google()
    mavenCentral()
    flatDir {
        dirs("../capacitor-cordova-android-plugins/src/main/libs", "libs")
    }
}

dependencies {
    // Capacitor
    implementation(project(":capacitor-android"))
    implementation(project(":capacitor-cordova-android-plugins"))
    implementation(project(":capacitor-keyboard"))
    implementation(project(":capacitor-splash-screen"))
    implementation(project(":capacitor-status-bar"))

    // Compose BOM
    implementation(platform("androidx.compose:compose-bom:2024.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    // Activity + Lifecycle
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.5")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.5")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.5")

    // Navigation
    implementation("androidx.navigation:navigation-compose:2.8.3")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // Networking
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // Auth0
    implementation("com.auth0.android:auth0:2.10.0")

    // Secure Storage
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Firebase (required by OneSignal for Android push)
    implementation(platform("com.google.firebase:firebase-bom:33.5.1"))
    implementation("com.google.firebase:firebase-messaging")

    // OneSignal push notifications
    implementation("com.onesignal:OneSignal:5.1.15")

    // DataStore (for theme prefs)
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // Google Fonts for Compose
    implementation("androidx.compose.ui:ui-text-google-fonts")

    // Core
    implementation("androidx.core:core-ktx:1.13.1")

    // Testing
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    testImplementation("junit:junit:4.13.2")
}
