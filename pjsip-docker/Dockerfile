# Force amd64 — le builder VoiSmart est conçu pour Linux x86_64
# Sur Mac M1/M2, Docker Desktop émule amd64 via Rosetta
FROM --platform=linux/amd64 ubuntu:20.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8

# Désactiver i386 pour éviter les erreurs 404 sur ports.ubuntu.com
RUN dpkg --remove-architecture i386 2>/dev/null || true

# Dépendances de base
RUN apt-get update && apt-get install -y \
    git curl wget unzip bzip2 binutils make autoconf \
    openssl libssl-dev libpcre2-dev build-essential \
    nasm python3 python2 openjdk-17-jdk \
    && rm -rf /var/lib/apt/lists/*

# Cloner le builder VoiSmart
RUN git clone https://github.com/VoiSmart/pjsip-android-builder.git /builder

WORKDIR /builder

# Rendre tous les scripts exécutables
RUN chmod +x prepare-build-system build openssl-build-target-archs opus-build bcg729-build openh264-build-target-archs 2>/dev/null || true

# Config locale : arm64-v8a uniquement, 16 KB activé, pas de vidéo ni G.729
# Désactiver tous les patches qui cherchent des chemins incorrects dans Docker
RUN cat > config.local.conf << 'EOF'
TARGET_ARCHS=("arm64-v8a")
ENABLE_OPENH264=0
DOWNLOAD_OPENH264=0
ENABLE_BCG729=0
DOWNLOAD_BCG729=0
ADD_DEBUG_SYMBOLS=0
ENABLE_16KB_PAGE_SIZE=1
SET_PERMISSIONS=0
USE_FIXED_CALLID=0
XFER_REPLACES_CONTACT=0
CHANGE_PJSIP_TRANSPORT_IDLE_TIME=0
EXPORT_RTCP_FB_DATA=0
FIX_MISSING_CONTACT_HEADER=0
EOF

# Préparer le système de build (télécharge NDK, SDK, OpenSSL, Opus, PJSIP)
RUN ./prepare-build-system

# Compiler PJSIP
RUN ./build

# Copier les artefacts dans /output
RUN mkdir -p /output && cp -r /builder/pjsip-output-build/. /output/

CMD ["echo", "Build terminé — artefacts dans /output"]
