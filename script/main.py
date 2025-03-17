from telethon import TelegramClient, events
from telethon.tl.functions.channels import JoinChannelRequest
from pymongo import MongoClient
from flask import Flask, request, jsonify

from dotenv import load_dotenv
import re
import os

load_dotenv()

app = Flask(__name__)
API_ID = os.getenv('API_ID')
API_HASH = os.getenv('API_HASH')
PHONE_NUMBER = os.getenv('PHONE_NUMBER')
SERVER_PORT = os.getenv('SERVER_PORT')

  # Include country code, e.g., +1234567890

DBserver = MongoClient("mongodb://localhost:27017/")
db = DBserver["Moonbot"]
collection = db["copytrades"]

# Regex to detect pump.fun contract addresses (44 characters + "pump")
PUMP_FUN_CA_REGEX = r"\b[1-9A-HJ-NP-Za-km-z]{44}pump\b"

# Target chat ID where you want to forward detected CAs
TARGET_CHAT_ID = 6007738067  # Use an integer, not a string

# List of chat IDs to monitor (use integers, not strings)
MONITORED_CHAT_IDS = [-1001536018812]  # Replace with the correct integer
ALL_CHATs =[];
# Initialize the Telegram client
client = TelegramClient("pump_fun_monitor_session", API_ID, API_HASH)

def should_monitor(chat_id):
    return chat_id in MONITORED_CHAT_IDS

async def process_messages(event):
    try:
        message_text = event.message.message
        print(f"New message: {event}")  # Debug: Print the message content
        # TODO: Get channel name, user's chatId with our trading bot, send CA and second chatId

        # Search for pump.fun contract addresses
        contract_addresses = re.findall(PUMP_FUN_CA_REGEX, message_text)
        print(f"Detected addresses: {contract_addresses}")  # Debug: Print detected addresses

        # Forward each detected CA to the target chat
        for ca in contract_addresses:
            if len(ca) == 48:  # 44 characters + 4 characters for "pump"
                print(f"Valid pump.fun CA: {ca}")  # Debug: Print valid pump.fun addresses
                print(f"Sending to target chat: {TARGET_CHAT_ID}")  # Debug: Print target chat ID
                await client.send_message(TARGET_CHAT_ID, ca)  # Send only the CA
    except Exception as e:
        print(f"Error processing message: {e}")


async def monitor_messages():
    client.remove_event_handler(process_messages)
    client.add_event_handler(process_messages, events.NewMessage(chats=lambda event: should_monitor(event.chat_id)))

async def joinChannel(channelName):
    channel = await client.get_entity(channelName)
    updates = await client(JoinChannelRequest(channel))
    MONITORED_CHAT_IDS.append("-100"+str(updates.chats[0].id))
    print(f"Detecting Channel list : {MONITORED_CHAT_IDS}" )

async def main():
    try:
        # Start the client
        await client.start(PHONE_NUMBER)
        print("Monitoring chats for pump.fun CAs...")
        await monitor_messages()
        # Debug: Print all dialogs (chats/groups/channels) the bot is part of
        async for dialog in client.iter_dialogs():
            ALL_CHATs.append({"username":dialog.entity.username, "id":dialog.id})
            print(f"Chat Name: {dialog.entity.username},,{dialog.id}")
        # await joinChannel("Maestrosdegen")
        await client.run_until_disconnected()
    except Exception as e:
        print(f"Error starting client: {e}")

@app.route('/refresh', methods=['POST'])
async def receive_data():
    try:
        #TODO: Update channel schedule/ update Array
        documents = collection.find({}, {"signal": 1, "_id": 0})
        all_signals = [] # store usernames

        # Iterate over each document
        for doc in documents:
            # Add the signals from each document to the all_signals list
            all_signals.extend(doc.get("signal", []))  # Extend adds elements from the iterable
        
        for signal in all_signals:
            joined = false
            for chat in ALL_CHATs:
                if chat["username"] == signal :
                    MONITORED_CHAT_IDS.append(chat["id"])
                    joined = true
                    break
            if joined == false :
                await joinChannel(signal)
        
        await monitor_messages()
        return jsonify({"status": "success"}), 200

    except Exception as e:
        # Handle any errors that occur
        print(f"Error processing data: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

# Function to run the Flask app
def run_flask():
    app.run(port=SERVER_PORT)  # Run Flask app on port

if __name__ == "__main__":
    # from threading import Thread
    # flask_thread = Thread(target=run_flask)
    # flask_thread.start()
    
    with client:
        client.loop.run_until_complete(main())