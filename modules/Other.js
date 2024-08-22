
const fs = require('fs');
const MarzbanAPI = require('./MarzbanAPI.js');

class Time{

    constructor(shortUnix){

        //проверка корректности
        if (typeof shortUnix !== 'number' && shortUnix) {
            throw new Error(`Некорретное время: '${shortUnix}'. Укажите Unix-время в секундах`);
        }

        this.time = shortUnix || (Date.now() / 1000);
    }

    //формат ISO 8601: YY-MM-DD
    fromUnix(fulltime = false){
        const date = new Date(this.time * 1000);
        const day = String(date.getDate()).padStart(2, '0');    // Заполнение нулями
        const month = String(date.getMonth() + 1).padStart(2, '0'); // Заполнение нулями
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');    // Заполнение нулями
        const minutes = String(date.getMinutes()).padStart(2, '0'); // Заполнение нулями
        const seconds = String(date.getSeconds()).padStart(2, '0'); // Заполнение нулями

        const formattedDate = `${year}-${month}-${day}${fulltime ? ` ${hours}:${minutes}:${seconds}` : ''}`;
        
        return formattedDate; 
    }

    addTime(shortUnix){

        //проверка корректности
        if(typeof shortUnix !== 'number') {
            throw new Error(`Некорретное время: '${shortUnix}'. Укажите Unix-время в миллисекундах`);
        }

        return new this.constructor(this.time + shortUnix); 
    }

    shortUnix(){
        return this.time;
    }
}

function RandCode(length = 6) {
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
    }
    return result;
}

//ведение логов
function WriteInLogFile(messageOrError){

    //информация для лога
    const time = new Time().fromUnix(true);
    const isError = messageOrError instanceof Error;
    let logClause = '', detailClause = '', messageLog = '';

    if(isError){
        //информация об ошибке
        logClause = ` [ERROR]: ${messageOrError.message}`;
        detailClause = messageOrError.stack ? `\n[DETAIL]: ${messageOrError.stack}` : '';
    }
    else logClause = ` [INFO]: ${messageOrError}`;

    //сообщение для лога
    messageLog = `[${time}]${logClause}${detailClause}\n`;

    //вывод в консоль
    console.log(messageLog);

    try {
        fs.appendFileSync('logs.txt', messageLog + '\n');
 
    } catch (err) {
        console.error(`Не удалось добавить лог: '${messageLog}'`, err);
    }
}

module.exports = {Time, RandCode, WriteInLogFile};
