
const fs = require('fs');
const Time = require('./Time.js');

function RandCode(length = 6) {
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
    }
    return result;
}

// Ведение логов
function WriteInLogFile(messageOrError){

    // Информация для лога
    const time = new Time().fromUnix(true);
    const isError = messageOrError instanceof Error;
    let logClause = '', detailClause = '', messageLog = '';

    if(isError){
        logClause = ` [ERROR]: ${messageOrError.message}`;
        detailClause = messageOrError.stack ? `\n[DETAIL]: ${messageOrError.stack}` : '';
    }
    else{
        logClause = ` [INFO]: ${messageOrError}`;
    }

    // Сообщение для лога
    messageLog = `[${time}]${logClause}${detailClause}\n`;

    // Вывод в консоль
    console.log(messageLog);

    try{
        fs.appendFileSync('logs.txt', messageLog + '\n');
 
    }catch(err) {
        console.error(`Не удалось добавить лог: '${messageLog}'`, err);
    }
}

module.exports = {Time, RandCode, WriteInLogFile};
