# Android build toolchain: JDK 17, Android SDK 34, Gradle 8.7.
# amd64 because Google ships the Android build tools (aapt2) for x86_64 Linux only.
FROM eclipse-temurin:17.0.13_11-jdk-jammy

ENV ANDROID_HOME=/opt/android-sdk \
    GRADLE_HOME=/opt/gradle
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$GRADLE_HOME/bin

RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip wget rsync \
 && rm -rf /var/lib/apt/lists/*

RUN wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O /tmp/clt.zip \
 && mkdir -p $ANDROID_HOME/cmdline-tools \
 && unzip -q /tmp/clt.zip -d $ANDROID_HOME/cmdline-tools \
 && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
 && rm /tmp/clt.zip \
 && yes | sdkmanager --licenses >/dev/null \
 && sdkmanager "platforms;android-34" "build-tools;34.0.0" >/dev/null

RUN wget -q https://services.gradle.org/distributions/gradle-8.7-bin.zip -O /tmp/gradle.zip \
 && unzip -q /tmp/gradle.zip -d /opt \
 && mv /opt/gradle-8.7 $GRADLE_HOME \
 && rm /tmp/gradle.zip
