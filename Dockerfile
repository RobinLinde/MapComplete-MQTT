FROM node:alpine

# Create app directory
WORKDIR /usr/src/app

# Copy app source
COPY . .

# Install app dependencies
RUN npm install

CMD [ "npm", "start" ]