ARG NODE_IMAGE=node:18-alpine

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
EXPOSE 8000
RUN mkdir /app
RUN chown node:node /app
USER node
WORKDIR /app
COPY --chown=node:node ["package.json", "package-lock.json*", "tsconfig*.json", "./"]
COPY --chown=node:node ["src", "./src"]
# Delete prepare script to avoid errors from husky
RUN npm pkg delete scripts.prepare \
    && npm ci --omit=dev
CMD [ "npm", "run", "start" ]
