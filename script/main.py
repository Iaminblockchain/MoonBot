from telethon import TelegramClient, events
from telethon.tl.functions.channels import JoinChannelRequest
from pymongo import MongoClient

from dotenv import load_dotenv
import re
import os
import requests
import json
import copy
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from datetime import datetime

load_dotenv()

API_ID = os.getenv('API_ID')
API_HASH = os.getenv('API_HASH')
PHONE_NUMBER = os.getenv('PHONE_NUMBER')
SERVER_PORT = os.getenv('SERVER_PORT')

  # Include country code, e.g., +1234567890

DBserver = MongoClient("mongodb://localhost:27017/")
db = DBserver["MoonBot"]
collection = db["copytrades"]

# Regex to detect pump.fun contract addresses (44 characters + "pump")
PUMP_FUN_CA_REGEX = r'\b[1-9A-HJ-NP-Za-km-z]{32,44}\b'

# Target chat ID where you want to forward detected CAs
TARGET_CHAT_ID = 6007738067  # Use an integer, not a string

# List of chat IDs to monitor (use integers, not strings)
MONITORED_CHAT_IDS = []  # Replace with the correct integer
NEW_MONITORED_CHAT_IDS = []
ALL_CHATs =[]
# Initialize the Telegram client
client = TelegramClient("pump_fun_monitor_session", API_ID, API_HASH)

scheduler = AsyncIOScheduler()



async def process_messages(event):
    try:
        channel_username = ""
        message_text = event.message.message
        channel_id = event.message.peer_id.channel_id
        # print(f"New message: {message_text}-{channel_id}")  # Debug: Print the message content
        # Search for pump.fun contract addresses
        contract_addresses = re.findall(PUMP_FUN_CA_REGEX, message_text)
        # print(f"Detected addresses: {contract_addresses}")  # Debug: Print detected addresses

        if len(contract_addresses) > 0:
            for chat in ALL_CHATs:
                if chat["id"] == int("-100"+str(channel_id)):
                    channel_username = chat["username"]
                    break
        # print(f"Send 3000/signal - address: {contract_addresses[0]},channel:{channel_username}")
        if channel_username != "":
            response = requests.post("http://localhost:3000/signal", json={"address": contract_addresses[0],"channel":channel_username })

    except Exception as e:
        print(f"Error processing message: {e}")


async def monitor_messages():
    global MONITORED_CHAT_IDS
    MONITORED_CHAT_IDS = copy.deepcopy(NEW_MONITORED_CHAT_IDS)
    client.remove_event_handler(process_messages)
    client.add_event_handler(process_messages, events.NewMessage(chats=MONITORED_CHAT_IDS))

async def joinChannel(channelName):
    try:
        channel = await client.get_entity(channelName)
        updates = await client(JoinChannelRequest(channel))
        NEW_MONITORED_CHAT_IDS.append(int("-100"+str(updates.chats[0].id)))
        ALL_CHATs.append({"username":updates.chats[0].username, "id":int(updates.chats[0].id)})
        print(f"Detecting Channel list : {NEW_MONITORED_CHAT_IDS}" )
    except Exception as e:
        print(f"joinChannel Error: {e} ")

async def find_monitor_chats():
    try:
        ALL_CHATs.clear()
        async for dialog in client.iter_dialogs():
            try:
                # print(f"Chat Name: {dialog.entity.username},,{dialog.id}")
                ALL_CHATs.append({"username":dialog.entity.username, "id":dialog.id})
            except Exception as e:
                print(f"Error: {e} - {dialog.title}")
                continue
        documents = collection.find({}, {"signal": 1, "_id": 0})

        all_signals = [] # store usernames
        # print(f"{ALL_CHATs}")

        # Iterate over each document
        for doc in documents:
            # Add the signals from each document to the all_signals list
            all_signals.extend(doc.get("signal", []))  # Extend adds elements from the iterable
        # print(f"all signal:{all_signals}")
        NEW_MONITORED_CHAT_IDS.clear()
        for signal in all_signals:
            joined = False
            for chat in ALL_CHATs:
                if chat["username"] == signal :
                    NEW_MONITORED_CHAT_IDS.append(chat["id"])
                    joined = True
                    break
            if joined == False :
                await joinChannel(signal)
        if NEW_MONITORED_CHAT_IDS != MONITORED_CHAT_IDS:
            await monitor_messages()

        print(f"MONITORED_CHAT_IDS - {MONITORED_CHAT_IDS}")
    except Exception as e:
        # Handle any errors that occur
        print(f"Error processing data: {e}")

async def main():
    try:
        # Start the client
        await client.start(PHONE_NUMBER)
        print("Monitoring chats for pump.fun CAs...")
        # Debug: Print all dialogs (chats/groups/channels) the bot is part of
        scheduler.add_job(find_monitor_chats, 'interval', minutes=1)
        scheduler.start()
        await client.run_until_disconnected()
    except Exception as e:
        print(f"Error starting client: {e}")


if __name__ == "__main__":    
    with client:
        client.loop.run_until_complete(main())