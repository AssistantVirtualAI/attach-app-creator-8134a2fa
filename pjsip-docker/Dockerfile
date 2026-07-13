FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8

# Dépendances de base
RUN apt-get update && apt-get install -y \
    git curl wget unzip bzip2 binutils make autoconf \
    openssl libssl-dev libopus0 libpcre2-dev build-essential \
    nasm python3 python2 openjdk-17-jdk \
    && rm -rf /var/lib/apt/lists/*

# Cloner le builder VoiSmart
RUN git clone https://github.com/VoiSmart/pjsip-android-builder.git /builder

WORKDIR /builder

# Config locale : arm64-v8a uniquement, 16 KB activé, pas de vidéo ni G.729
RUN cat > config.local.conf << 'EOF'
TARGET_ARCHS=("arm64-v8a")
ENABLE_OPENH264=0
DOWNLOAD_OPENH264=0
ENABLE_BCG729=0
DOWNLOAD_BCG729=0
ADD_DEBUG_SYMBOLS=0
ENABLE_16KB_PAGE_SIZE=1
SET_PERMISSIONS=0
EOF

# Préparer le système de build (télécharge NDK, SDK, OpenSSL, Opus, PJSIP)
RUN chmod +x prepare-build-system && ./prepare-build-system

# Compiler PJSIP
RUN chmod +x build && ./build

# Copier les artefacts dans /output
RUN mkdir -p /output && cp -r /builder/pjsip-output-build/. /output/

CMD ["echo", "Build complete — artefacts dans /output"]
