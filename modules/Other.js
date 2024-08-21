
const fs = require('fs');

class Time{

    constructor(dateString = Date.now(), unixFormat = true){
        if(unixFormat){
            if(typeof dateString !== 'number') throw new Error(`Некорретное время: '${dateString}'. Укажите Unix-время в миллисекундах`);
            this.time = dateString;
        //конвертация в UTC время
        }else{
            this.time = this.toUnix(dateString);
        }
    }

    //формат ISO 8601: YY-MM-DD
    fromUnix(filldate = false){
        const date = new Date(this.time);
        const day = String(date.getDate()).padStart(2, '0');    // Заполнение нулями
        const month = String(date.getMonth() + 1).padStart(2, '0'); // Заполнение нулями
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');    // Заполнение нулями
        const minutes = String(date.getMinutes()).padStart(2, '0'); // Заполнение нулями
        const seconds = String(date.getSeconds()).padStart(2, '0'); // Заполнение нулями

        const formattedDate = `${year}-${month}-${day}${filldate ? ` ${hours}:${minutes}:${seconds}` : ''}`;
        
        return formattedDate; 
    }

    addTime(shortUnix){
        if(typeof shortUnix !== 'number') throw new Error(`Некорретное время: '${shortUnix}'. Укажите Unix-время в миллисекундах`);
        return new this.constructor(this.time + shortUnix * 1000); 
    }

    toShortUnix(dateString){
        const shortUnixTime = Math.ceil(this.toUnix(dateString)/1000);
        return shortUnixTime;
    }

    toUnix(dateString){

        //текущее время
        if(!dateString) return this.time;

        //формат ISO 8601: YY-MM-DD
        if(typeof dateString !== 'string' || dateString.length !== 10 || !dateString.match(/\d{4}-\d{2}-\d{2}/)){
            throw new Error(`Некорретное время: '${dateString}'. Укажите yyyy-mm-dd`);
        }

        //преобразование в миллисекунды
        const [day, month, year] = dateString.split('-');
        const date = new Date(year, month - 1, day);
        return date.getTime();
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

    let logClause = '', altnameClause = '', detailClause = '', messageLog = '';

    if(isError){
        //информация об ошибке
        logClause = ` [ERROR]: ${messageOrError.message}`;
        detailClause = messageOrError.stack ? `\n[DETAIL]: ${messageOrError.stack}` : '';
        if(messageOrError.altname) altnameClause = ` [ALTNAME]: ${messageOrError.altname}`;
    }
    else logClause = ` [INFO]: ${messageOrError}`;

    //сообщение для лога
    messageLog = `[${time}]${altnameClause}${logClause}${detailClause}\n`;

    //вывод в консоль
    console.log(messageLog);

    try {
        fs.appendFileSync('logs.txt', messageLog + '\n');
 
    } catch (err) {
        console.error(`Не удалось добавить лог: '${messageLog}'`, err);
    }
}

module.exports = {Time, RandCode, WriteInLogFile};
