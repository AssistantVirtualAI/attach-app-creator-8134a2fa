# Lemtel Edge Phase 12 - closed local Kamailio test image (disposable, static 503 only).
FROM debian:12.12-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends kamailio python3-minimal \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 65532 lemtelclosed \
 && useradd --system --uid 65532 --gid 65532 --no-create-home --shell /usr/sbin/nologin lemtelclosed
COPY --chown=root:root --chmod=0444 kamailio.cfg /opt/lemtel-closed/kamailio.cfg
RUN kamailio -c -f /opt/lemtel-closed/kamailio.cfg
USER 65532:65532
ENTRYPOINT ["kamailio", "-m", "32", "-M", "8", "-f", "/opt/lemtel-closed/kamailio.cfg"]
