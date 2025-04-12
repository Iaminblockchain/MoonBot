#!/bin/bash
mongoexport --db moonbot --collection chats --out data/chats_backup.json --jsonArray
mongo moonbot --eval "db.chats.drop()"
mongoimport --db moonbot --collection chats --file data/chats_01.json --jsonArray