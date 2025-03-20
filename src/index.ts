import * as bot from "./bot";
import { SERVER_PORT } from "./config";
import { setAutotrade } from "./controllers/autoBuyController";
import * as db from "./db";
import express from 'express';
import { getChatIdByChannel } from "./models/copyTradeModel";

const app = express();
app.use(express.json());
app.post('/signal', async (req, res) => {
    try {
        const data = req.body;
        const chatIds = await getChatIdByChannel(data.channel)
        chatIds.forEach((id)=>{
            console.log("run auto signal:", id, data.address)
            setAutotrade(id, data.address);
        })
        return res.status(200).json({ status: 'Success' });
    } catch(e) {
        console.log("Error", e)
        return res.status(400).json({ status: 'Error' });
    }
});

const main = () => {
    db.connect();
    bot.init();
    
    app.listen(SERVER_PORT, () => {
        console.log(`Bot Server running at http://localhost:${SERVER_PORT}`);
    });
};

main();