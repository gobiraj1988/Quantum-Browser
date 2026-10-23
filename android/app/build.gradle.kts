plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.quantum.browser"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.quantum.browser"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        // Release signing comes from environment variables so the keystore is never committed.
        create("release") {
            val ks = System.getenv("QUANTUM_KEYSTORE")
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("QUANTUM_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("QUANTUM_KEY_ALIAS")
                keyPassword = System.getenv("QUANTUM_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (System.getenv("QUANTUM_KEYSTORE") != null) signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // The app uses only the Android framework + Kotlin stdlib: tiny APK, fast cold start.
    testImplementation(libs.junit)
}
