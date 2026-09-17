FROM node:22.23.2-bookworm-slim

ENV NODE_ENV=production PUPPETEER_CACHE_DIR=/opt/puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl fontconfig iptables util-linux \
    fonts-dejavu-core fonts-liberation fonts-noto-core fonts-noto-color-emoji \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libgbm1 \
    libgtk-3-0 libnspr4 libnss3 libx11-xcb1 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libxkbcommon0 \
    && rm -rf /var/lib/apt/lists/*
# Preserve the fonts used by the existing renderer.
RUN curl -fsSL https://raw.githubusercontent.com/debitoor/heroku-buildpack-converter-fonts/fd57654fa73dedaf8d4910e34880ed8e5af818d3/fonts.tar.gz -o /tmp/fonts.tar.gz \
    && mkdir -p /usr/local/share/fonts/heroku \
    && tar -xzf /tmp/fonts.tar.gz -C /usr/local/share/fonts/heroku \
    && rm /tmp/fonts.tar.gz && fc-cache -f
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npx puppeteer browsers install chrome \
    && test -x "$(node -p 'require("puppeteer").executablePath()')" \
    && npm cache clean --force \
    && chmod -R a+rX /opt/puppeteer \
    && find /opt/puppeteer -name chrome_sandbox -exec chown root:root {} \; -exec chmod 4755 {} \;
COPY src ./src
COPY deploy/container-entrypoint /usr/local/bin/pdf-entrypoint
RUN chmod 755 /usr/local/bin/pdf-entrypoint
ENV HOST=0.0.0.0 PORT=9000 CHROME_NO_SANDBOX=false
EXPOSE 9000
ENTRYPOINT ["/usr/local/bin/pdf-entrypoint"]
CMD ["node", "src/index.js"]
