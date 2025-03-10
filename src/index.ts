import * as bot from "./bot";
import * as db from "./db";

const main = () => {
    db.connect();
    bot.init();    
};

main();