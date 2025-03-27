import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import promptSync from "prompt-sync";
import { retrieveEnvVariable } from "./config";

const prompt = promptSync({ sigint: true });

const API_ID = Number(retrieveEnvVariable("telegram_api_id"));
const API_HASH = retrieveEnvVariable("telegram_api_hash");
const PHONE_NUMBER = retrieveEnvVariable("telegram_phone_number");
const client = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
  connectionRetries: 5,
});
async function loginTelegram(): Promise<void> {
  try {
    // Start the Telegram client
    await client.connect();

    if (!(await client.checkAuthorization())) {
      await client.signInUser(
        {
          apiId: API_ID,
          apiHash: API_HASH,
        },
        {
          phoneNumber: PHONE_NUMBER,
          password: async () => prompt("password?"),
          phoneCode: async () => prompt("Code ?"),
          onError: (err) => console.log(err),
        }
      );
      console.log("Session string:", client.session.save());
    }
  } catch (e) {
    console.error(`Error starting client: ${e}`);
  }
}

loginTelegram();
