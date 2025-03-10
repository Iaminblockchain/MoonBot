import TelegramBot from "node-telegram-bot-api";
import { botInstance, switchMenu, getChatIdandMessageId, setState, STATE, setDeleteMessageId, getDeleteMessageId } from "../bot";
import { SOLANA_CONNECTION } from '../config';
import * as walletdb from '../models/walletModel';
import * as tradedb from '../models/tradeModel';
import * as solana from '../solana';

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
    try {
        const data = query.data;
        if (data == "positionController_start") {
            showPositionPad(query);
        } else if (data == "positionController_50%") {
           
        } else if (data == "positionController_100%") {
        }
    } catch (error) {

    }
}

const showPositionPad = (query: TelegramBot.CallbackQuery) => {

}

