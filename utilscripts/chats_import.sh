#!/bin/bash
#mongoexport --db moonbot --collection chats --out data/chats_backup.json --jsonArray
#mongo moonbot --eval "db.chats.drop()"
#mongoimport --db moonbot --collection chats --file data/chats_01.json --jsonArray

MONGO_URI="mongodb://127.0.0.1:27017/moonbot" mongoimport \
  --uri="$MONGO_URI" \
  --db=moonbot \
  --collection=chats \
  --file=data/chats_01.json \
  --jsonArray

mongoimport \
  --uri="mongodb://127.0.0.1:27017/moonbot" \
  --db=moonbot \
  --collection=chats \
  --file=data/chats_01.json \
  --jsonArray