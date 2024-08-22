
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

//автоматическая отчистка истекших заказов
class AutoClearMarzbanExcitedOffers{

    //стек офферов
    static stack = [];

    //Данный класс может содержать устаревшие данные о заказе (как строка подключения)
    //Однако имя заказа и дату истечения класс всегда должен держать верную

    //очистка стека 
    static removeTrack(offer_id){
        //очистка таймаута
        const thisOffer = AutoClearMarzbanExcitedOffers.stack.find(item => item.offer_id === offer_id);

        //удаление из стека
        if(thisOffer) {
            WriteInLogFile(`Отменен мониторинг для заказа ${offer_id} 👌`);
            clearTimeout(thisOffer._timeout_id);
            AutoClearMarzbanExcitedOffers.stack = AutoClearMarzbanExcitedOffers.stack.filter((item) => item.offer_id !== offer_id);
        }
        else WriteInLogFile(`Для заказа №${offer_id} мониторинг не был установлен ранее 🔭`);
    }

    static track(offer){
        
        //получение времени
        const timeNow = Math.ceil(Date.now() / 1000);
        const endTime = offer.end_time;
        const timeout = 5000//(endTime - timeNow) * 1000;

        //проверка на истечение времени (Не может работать для нового заказа)
        if(timeout < 0) return;

        //запуск таймера
        offer['_timeout'] = timeout;
        offer['_timeout_id'] = setTimeout(async () => {
            const username = `${offer.sub_id}_${offer.offer_id}`;
            try{
                //очистка пользователя и удаление из стека
                await MarzbanAPI.DELETE_USER(username);
                AutoClearMarzbanExcitedOffers.stack = AutoClearMarzbanExcitedOffers.stack.filter((item) => item.offer_id !== offer.offer_id);
                
                WriteInLogFile(`Удален истекший заказ Marzban: ${username} ⌛`);
            }
            catch(err){

                // Ошибка при обращении к серверу
                if (err.response) {
                    const statusCode = err.response.status;
                    const errorMessage = err.response.data.detail.body;
                    
                    console.log(err.response.data);

                    WriteInLogFile(new Error(`Не удалось удалить заказ Marzban: ${statusCode} ${errorMessage}`));
                }
                else {
                    // Запрос был сделан, но ответа от сервера не было
                    err.message = 'Запланированое удаление заказа Marzban: ' + (err.message || 'Сервер Marzban не отвечает');

                    WriteInLogFile(err);
                }
            }
        }, timeout);

        //добавление в стек
        AutoClearMarzbanExcitedOffers.stack.push(offer);
        WriteInLogFile(`Мониторинг заказа Marzban №${offer.offer_id}. Заказ будет удален в системе: ${new Time(endTime).fromUnix(true)} 🕓`);
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

module.exports = {Time, RandCode, WriteInLogFile, AutoClearMarzbanExcitedOffers};
