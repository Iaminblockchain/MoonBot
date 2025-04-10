# MoonbotServer

npm run start
npm run seedchannels
mongosh mongodb://localhost:27017/moonbot

copy .env.example to .env and adjust

## nginx config
// cp nginx_conf   /etc/nginx/sites-available/moonbot
sudo ln -s /etc/nginx/sites-available/moonbot /etc/nginx sites-enabled/
root@vultr:~/server# sudo nginx -t
