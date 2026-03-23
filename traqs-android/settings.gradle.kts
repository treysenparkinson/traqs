pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "TRAQS Scheduling"
include(":app")
include(":capacitor-cordova-android-plugins")
project(":capacitor-cordova-android-plugins").projectDir = File("./capacitor-cordova-android-plugins")
include(":capacitor-android")
project(":capacitor-android").projectDir = File("../node_modules/@capacitor/android/capacitor")
include(":capacitor-keyboard")
project(":capacitor-keyboard").projectDir = File("../node_modules/@capacitor/keyboard/android")
include(":capacitor-splash-screen")
project(":capacitor-splash-screen").projectDir = File("../node_modules/@capacitor/splash-screen/android")
include(":capacitor-status-bar")
project(":capacitor-status-bar").projectDir = File("../node_modules/@capacitor/status-bar/android")
