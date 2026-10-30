plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "nz.ac.aut.taskflow"
    compileSdk = 34

    defaultConfig {
        applicationId = "nz.ac.aut.taskflow"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "3.0"
        // 10.0.2.2 is the host computer as seen from the Android emulator.
        // For a real phone, change this to your computer's Wi-Fi address (and add it to network_security_config.xml).
        buildConfigField("String", "BASE_URL", "\"http://10.0.2.2:3000\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
