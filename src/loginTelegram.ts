import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import promptSync from "prompt-sync";
import { retrieveEnvVariable } from "./config";
import { logger } from "./util";

const prompt = promptSync({ sigint: true });

const TELEGRAM_APP_ID = Number(retrieveEnvVariable("telegram_api_id"));
const TELEGRAM_API_HASH = retrieveEnvVariable("telegram_api_hash");
const client = new TelegramClient(new StringSession(""), TELEGRAM_APP_ID, TELEGRAM_API_HASH, {
  connectionRetries: 5,
});
async function loginTelegram(): Promise<void> {
  try {
    // Start the Telegram client
    await client.connect();

    if (!(await client.checkAuthorization())) {
      await client.signInUser(
        {
          apiId: TELEGRAM_APP_ID,
          apiHash: TELEGRAM_API_HASH,
        },
        {
          phoneNumber: async () => prompt("Phone number? "),
          password: async () => prompt("Password? "),
          phoneCode: async () => prompt("Code? "),
          onError: (err) => { logger.error(err); },
        }
      );
      logger.info("Session string:", client.session.save());
    }
  } catch (e) {
    logger.error(`Error starting client: ${e}`);
  }
}

loginTelegram();
