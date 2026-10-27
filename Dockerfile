# ShowVault: imagem de produção (sem etapa de build: o frontend é HTML/CSS/JS puro).
#
#   docker build -t showvault .
#   docker run -d -p 3000:3000 -v showvault-data:/data -e JWT_SECRET=<segredo longo> showvault
#
# Os dados (usuários, bibliotecas, catálogo) ficam em /data, um único arquivo SQLite: monte um volume persistente ali.
# Rode UMA instância por volume (SQLite não é para vários servidores escrevendo no mesmo arquivo).
# Node 26 é a versão em que o módulo embutido node:sqlite é estável (ver Documentacao/02-decisoes.md, D-S10-1).
FROM node:26-slim

# HOST=0.0.0.0: dentro do contêiner o servidor precisa escutar em todas as interfaces para o -p 3000:3000 funcionar
# (fora do Docker, em produção, o padrão é 127.0.0.1: só o próprio computador; ver Documentacao/deploy-pc-tailscale.md).
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    STORAGE=sqlite \
    SHOWVAULT_DATA_DIR=/data

WORKDIR /app

# Dependências primeiro (aproveita o cache de camadas); só as de produção.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY server ./server
COPY public ./public
# Ferramenta de armazenamento (docker exec <container> node scripts/storage.js export /tmp/saida)
COPY scripts/storage.js ./scripts/storage.js

# /data pertence ao usuário "node" (sem root). Um volume novo herda esse dono.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
