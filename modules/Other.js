
import fs from 'fs';
import Time from './Time.js';

function RandCode(length = 6) {
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
    }
    return result;
}

function FormatBytes(bytes) {
    if (bytes === 0) return '0 Б';
  
    const sizes = ['Б', 'Кб', 'Мб', 'Гб', 'Тб', 'Пб'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const formattedSize = (bytes / Math.pow(1024, i)).toFixed(2); // Округляем до 2 знаков после запятой
  
    return `${formattedSize} ${sizes[i]}`;
  }

// Ведение логов
function WriteInLogFile(messageOrError){

    // Информация для лога
    const time = new Time().toFormattedString();
    const isError = (messageOrError instanceof Error);
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

export default {Time, RandCode, WriteInLogFile, FormatBytes};
