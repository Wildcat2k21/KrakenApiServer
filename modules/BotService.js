require('dotenv').config();
const axios = require('axios');
const TELEGRAM_SERVICE_URL = process.env.TELEGRAM_SERVICE_URL;

class BotService {

    static serviceUrl = TELEGRAM_SERVICE_URL;

    //оповещения в телеграм боте
    static async NOTIFY(users) {
        const response = await axios.post(`${BotService.serviceUrl}/notify`, {users});

        return response.data;
    }
}

module.exports = BotService;