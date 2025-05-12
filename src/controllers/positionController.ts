import TelegramBot from "node-telegram-bot-api";
import { botInstance } from "../bot";
import { getWalletByChatId } from "../models/walletModel";
import { getPublicKeyinFormat } from "./sellController";
import { getAllTokensWithBalance } from "../solana/trade";
import { getTokenInfofromMint, getTokenMetaData } from "../solana/token";
import { logger } from "../logger";
import { SOLANA_CONNECTION } from "..";
import { PublicKey } from "@solana/web3.js";
import { getPositionsByChatId, getPositionByTokenAddress, closePosition } from "../models/positionModel";
import * as solana from "../solana/trade";
import { getTokenPrice } from "../getPrice";

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
	if (!botInstance) {
		logger.error("Bot instance not initialized in positionController.handleCallBackQuery");
		return;
	}

	try {
		const { data: callbackData, message: callbackMessage } = query;
		if (!callbackData || !callbackMessage) return;
		let callback_str = String(callbackMessage.chat.id);

		if (callbackData === "pos_start") {
			showPositionMenu(callback_str);
		} else if (callbackData === "pos_open") {
			showOpenPositions(callback_str);
		} else if (callbackData === "pos_closed") {
			showClosedPositions(callback_str);
		} else if (callbackData.startsWith("pos_token_")) {
			const tokenAddress = callbackData.split("_")[2];
			showTokenInfo(callback_str, tokenAddress);
		} else if (callbackData.startsWith("pos_closed_")) {
			const tokenAddress = callbackData.split("_")[2];
			showClosedTokenInfo(callback_str, tokenAddress);
		} else if (callbackData.startsWith("pos_sell_")) {
			const tokenAddress = callbackData.split("_")[2];
			handleSellPosition(callback_str, tokenAddress);
		} else if (callbackData === "pos_back") {
			showPositionMenu(callback_str);
		}
	} catch (error) {
		logger.error("Error in positionController.handleCallBackQuery", { error });
	}
};

const showPositionMenu = async (chatId: string) => {
	if (!botInstance) {
		logger.error("Bot instance not initialized in showPositionMenu");
		return;
	}

	const title = "📊 <b>Position management</b>\n\nYou can manage and check your open and closed positions here.";
	const buttons = [
		[
			{ text: "Open Positions", callback_data: "pos_open" },
			{ text: "Closed Positions", callback_data: "pos_closed" },
		],
		[{ text: "Close", callback_data: "close" }],
	];

	await botInstance.sendMessage(chatId, title, {
		reply_markup: { inline_keyboard: buttons },
		parse_mode: "HTML",
	});
};

const showOpenPositions = async (chatId: string) => {
	if (!botInstance) {
		logger.error("Bot instance not initialized in showOpenPositions");
		return;
	}

	try {
		const positions = await getPositionsByChatId(chatId);
		logger.info("------------------>>positions<<----------------");
		logger.info(`positions`, { positions });
		const openPositions = positions.filter((p) => p.status === "OPEN");

		if (openPositions.length === 0) {
			await botInstance.sendMessage(chatId, "No open positions found.", {
				reply_markup: {
					inline_keyboard: [[{ text: "Back", callback_data: "close" }]],
				},
			});
			return;
		}

		// Sort positions by buy time (oldest first)
		openPositions.sort((a, b) => a.buyTime.getTime() - b.buyTime.getTime());

		// Get token metadata for all positions
		const positionsWithMetadata = await Promise.all(
			openPositions.map(async (position, index) => {
				const tokenMetaData = await getTokenMetaData(SOLANA_CONNECTION, position.tokenAddress);
				return {
					tokenAddress: position.tokenAddress,
					buyPrice: position.buyPrice,
					stopLossPercentage: position.stopLossPercentage,
					takeProfitPercentage: position.takeProfitPercentage,
					solAmount: position.solAmount,
					buyTime: position.buyTime,
					status: position.status,
					index: index + 1,
					tokenName: tokenMetaData?.name || "Unknown Token",
					tokenSymbol: tokenMetaData?.symbol || "UNKNOWN",
				};
			})
		);

		logger.info("------------------>>positionsWithMetadata<<----------------");
		logger.info(`positionsWithMetadata: `, { positionsWithMetadata });

		const buttons = positionsWithMetadata.map((position) => [
			{
				text: `${position.index}. ${position.tokenSymbol} (${position.tokenName}) - ${position.buyTime.toLocaleString()}`,
				callback_data: `pos_token_${position.tokenAddress}`,
			},
		]);
		logger.info(`buttons`, { buttons });
		buttons.push([{ text: "Back", callback_data: "close" }]);

		await botInstance.sendMessage(chatId, "📊 <b>Open Positions</b>\n\nSelect a position to view details:", {
			reply_markup: { inline_keyboard: buttons },
			parse_mode: "HTML",
		});
	} catch (error) {
		logger.error("Error in showOpenPositions", { error });
		await botInstance.sendMessage(chatId, "❌ Error fetching positions");
	}
};

const showClosedPositions = async (chatId: string) => {
	if (!botInstance) {
		logger.error("Bot instance not initialized in showClosedPositions");
		return;
	}

	try {
		const positions = await getPositionsByChatId(chatId);
		const closedPositions = positions.filter((p) => p.status === "CLOSED");

		if (closedPositions.length === 0) {
			await botInstance.sendMessage(chatId, "No closed positions found.", {
				reply_markup: {
					inline_keyboard: [[{ text: "Back", callback_data: "close" }]],
				},
			});
			return;
		}

		// Sort positions by close time (most recent first)
		closedPositions.sort((a, b) => (b.closeTime?.getTime() || 0) - (a.closeTime?.getTime() || 0));

		// Get token metadata for all positions
		const positionsWithMetadata = await Promise.all(
			closedPositions.map(async (position, index) => {
				const tokenMetaData = await getTokenMetaData(SOLANA_CONNECTION, position.tokenAddress);
				const timeAgo = getTimeAgo(position.closeTime || new Date());
				return {
					tokenAddress: position.tokenAddress,
					index: index + 1,
					tokenName: tokenMetaData?.name || "Unknown Token",
					tokenSymbol: tokenMetaData?.symbol || "UNKNOWN",
					timeAgo: timeAgo,
				};
			})
		);

		const buttons = positionsWithMetadata.map((position) => [
			{
				text: `${position.index}. ${position.tokenSymbol} (closed ${position.timeAgo})`,
				callback_data: `pos_closed_${position.tokenAddress}`,
			},
		]);
		buttons.push([{ text: "Back", callback_data: "close" }]);

		await botInstance.sendMessage(chatId, "📊 <b>Closed Positions</b>\n\nSelect a position to view details:", {
			reply_markup: { inline_keyboard: buttons },
			parse_mode: "HTML",
		});
	} catch (error) {
		logger.error("Error in showClosedPositions", { error });
		await botInstance.sendMessage(chatId, "❌ Error fetching closed positions");
	}
};

const showClosedTokenInfo = async (chatId: string, tokenAddress: string) => {
	if (!botInstance) {
		logger.error("Bot instance not initialized in showClosedTokenInfo");
		return;
	}

	try {
		const position = await getPositionByTokenAddress(chatId, tokenAddress);
		if (!position || position.status !== "CLOSED") {
			throw new Error("Closed position not found");
		}

		const tokenMetaData = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
		if (!tokenMetaData) {
			throw new Error("Token metadata not found");
		}

		const buyTime = position.buyTime.toLocaleTimeString();
		const takeProfitPrice = position.buyPrice * (1 + position.takeProfitPercentage / 100);
		const stopLossPrice = position.buyPrice * (1 - position.stopLossPercentage / 100);

		const message =
			`📊 <b>Closed Position Details</b>\n\n` +
			`${tokenMetaData.name} (${tokenMetaData.symbol})\n` +
			`Address: <code>${tokenAddress}</code>\n\n` +
			`Source: ${position.signalSource ? "@" + position.signalSource : "Manual"}\n` +
			`Bought at: $${position.buyPrice}\n` +
			`Take profit: ${position.takeProfitPercentage}% ($${takeProfitPrice.toFixed(4)})\n` +
			`Stop loss: ${position.stopLossPercentage}% ($${stopLossPrice.toFixed(4)})\n\n` +
			`Closed Price: $${position.closePrice}\n` +
			`Close time: ${position.closeTime?.toLocaleString()}\n\n` +
			`ROI: ${(((position.closePrice! - position.buyPrice) / position.buyPrice) * 100).toFixed(2)}%`;

		const buttons = [[{ text: "Back", callback_data: "close" }]];

		await botInstance.sendMessage(chatId, message, {
			reply_markup: { inline_keyboard: buttons },
			parse_mode: "HTML",
		});
	} catch (error) {
		logger.error("Error in showClosedTokenInfo", { error });
		await botInstance.sendMessage(chatId, "❌ Error fetching closed position information");
	}
};

// Helper function to get time ago string
const getTimeAgo = (date: Date): string => {
	const now = new Date();
	const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
	if (diffInSeconds < 60) {
		return `${diffInSeconds} seconds ago`;
	} else if (diffInSeconds < 3600) {
		const minutes = Math.floor(diffInSeconds / 60);
		return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
	} else if (diffInSeconds < 86400) {
		const hours = Math.floor(diffInSeconds / 3600);
		return `${hours} hour${hours > 1 ? "s" : ""} ago`;
	} else {
		const days = Math.floor(diffInSeconds / 86400);
		return `${days} day${days > 1 ? "s" : ""} ago`;
	}
};

const showTokenInfo = async (chatId: string, tokenAddress: string) => {
	if (!botInstance) {
		logger.error("Bot instance not initialized in showTokenInfo");
		return;
	}

	try {
		const position = await getPositionByTokenAddress(chatId, tokenAddress);
		if (!position) {
			throw new Error("Position not found");
		}

		logger.info("Position found", { position });
		const tokenMetaData = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
		if (!tokenMetaData) {
			throw new Error("Token metadata not found");
		}

		logger.info("Token metadata found", { tokenMetaData });
		const currentPrice = await getTokenPrice(tokenAddress);
		const performance = (((currentPrice - position.buyPrice) / position.buyPrice) * 100).toFixed(2);
		const stopLossPrice = position.buyPrice * (1 - position.stopLossPercentage / 100);
		const takeProfitPrice = position.buyPrice * (1 + position.takeProfitPercentage / 100);

		// Calculate token amount with decimals
		const tokenAmount = position.tokenAmount / Math.pow(10, tokenMetaData.decimals);

		const message =
			`📊 <b>Position Details</b>\n\n` +
			`Token: ${tokenMetaData.symbol} (${tokenMetaData.name})\n` +
			`Address: <code>${tokenAddress}</code>\n` +
			`Source: ${position.signalSource ? "@" + position.signalSource : ""}\n` +
			`Token Amount: ${tokenAmount} ${tokenMetaData.symbol}\n` +
			`Buy Price: ${position.buyPrice}\n` +
			`Current Price: ${currentPrice}\n` +
			`Performance: ${performance}%\n` +
			`Stop Loss: ${position.stopLossPercentage}% (${stopLossPrice})\n` +
			`Take Profit: ${position.takeProfitPercentage}% (${takeProfitPrice})\n` +
			`Bought Time: ${position.buyTime.toLocaleString()}`;

		const buttons = [
			[
				{ text: "Sell Now", callback_data: `pos_sell_${tokenAddress}` },
				{ text: "View on DexScreener", url: `https://dexscreener.com/solana/${tokenAddress}` },
			],
			[{ text: "Back", callback_data: "close" }],
		];

		logger.info("----------------->>Buttons<<----------------");
		await botInstance.sendMessage(chatId, message, {
			reply_markup: { inline_keyboard: buttons },
			parse_mode: "HTML",
		});
	} catch (error) {
		logger.error("Error in showTokenInfo", { error: JSON.stringify(error) });
		await botInstance.sendMessage(chatId, "❌ Error fetching position information");
	}
};

const handleSellPosition = async (chatId: string, tokenAddress: string) => {
	if (!botInstance) {
		logger.error("Bot instance not initialized in handleSellPosition");
		return;
	}

	try {
		const position = await getPositionByTokenAddress(chatId, tokenAddress);
		if (!position) {
			throw new Error("Position not found");
		}

		const tokenMetaData = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
		if (!tokenMetaData) {
			throw new Error("Token metadata not found");
		}

		// Get wallet for selling
		const wallet = await getWalletByChatId(chatId);
		if (!wallet) {
			throw new Error("Wallet not found");
		}

		// Calculate token amount with decimals for display
		const tokenAmount = position.tokenAmount / Math.pow(10, tokenMetaData.decimals);

		// Send processing message
		await botInstance.sendMessage(chatId, `🔄 Processing sell order for ${tokenAmount} ${tokenMetaData.symbol}...`);

		// Send sell transaction
		const result = await solana.jupiter_swap(
			SOLANA_CONNECTION,
			wallet.privateKey,
			tokenAddress,
			solana.WSOL_ADDRESS,
			position.tokenAmount, // Use raw token amount for the swap
			"ExactIn",
			false
		);

		if (result && result.confirmed) {
			// Get current price for closing position
			const currentPrice = await getTokenPrice(tokenAddress);
			await closePosition(chatId, tokenAddress, currentPrice);

			const profitLoss = (currentPrice - position.buyPrice) * position.solAmount;
			const profitLossPercentage = (((currentPrice - position.buyPrice) / position.buyPrice) * 100).toFixed(2);
			const profitLossText = profitLoss >= 0 ? "Profit" : "Loss";

			const message =
				`✅ <b>Position Closed Successfully!</b>\n\n` +
				`Token: ${tokenMetaData.symbol} (${tokenMetaData.name})\n` +
				`Amount Sold: ${tokenAmount} ${tokenMetaData.symbol}\n` +
				`Buy Price: $${position.buyPrice}\n` +
				`Sell Price: $${currentPrice}\n` +
				`${profitLossText}: $${Math.abs(profitLoss).toFixed(10)} (${profitLossPercentage}%)\n` +
				`Transaction: http://solscan.io/tx/${result.txSignature}`;

			const buttons = [
				[
					{ text: "Open Positions", callback_data: "pos_open" },
					{ text: "Position", callback_data: "pos_start" },
				],
			];

			await botInstance.sendMessage(chatId, message, {
				reply_markup: { inline_keyboard: buttons },
				parse_mode: "HTML",
				disable_web_page_preview: true,
			});
		} else {
			throw new Error("Sell transaction failed");
		}
	} catch (error) {
		logger.error("Error in handleSellPosition", { error });
		await botInstance.sendMessage(chatId, "❌ Error selling position: " + (error as Error).message);
	}
};
