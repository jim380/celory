FROM node:lts-alpine as base

RUN apk update && apk add --no-cache g++ make python3

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

# If you are building your code for production
# RUN npm ci --only=production

COPY . .

FROM base as final

ENV NODE_PATH=./build

RUN npm run build

EXPOSE 3000

CMD [ "npm", "start" ]