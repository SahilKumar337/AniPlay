FROM node:20-slim

# Install latest chrome dev package and fonts to support major charsets (Chinese, Japanese, Arabic, Hebrew, Thai and a few others)
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set env path for Puppeteer/Playwright
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV PORT=7860

# Switch to the pre-existing 'node' user (which already has UID 1000 in node images)
USER node
ENV HOME=/home/node
ENV PATH=/home/node/.local/bin:$PATH

WORKDIR $HOME/app

# Copy dependency files and install (all as non-root 'node' user)
COPY --chown=node:node package*.json ./
RUN npm install

# Copy application code (all as non-root 'node' user)
COPY --chown=node:node . .

EXPOSE 7860

CMD ["node", "server/proxy.mjs"]
