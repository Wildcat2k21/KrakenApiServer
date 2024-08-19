
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

    fromUnix(){
        const date = new Date(this.time);
        const day = String(date.getDate()).padStart(2, '0');    // Заполнение нулями
        const month = String(date.getMonth() + 1).padStart(2, '0'); // Заполнение нулями
        const year = date.getFullYear();
        const formattedDate = `${day}-${month}-${year}`;
        
        return formattedDate; 
    }

    addTime(unix){
        if(typeof unix !== 'number') throw new Error(`Некорретное время: '${unix}'. Укажите Unix-время в миллисекундах`);
        return new this.constructor(this.time + unix); 
    }

    toShortUnix(dateString){
        const shortUnixTime = Math.ceil(this.toUnix(dateString)/1000);
        return shortUnixTime;
    }

    toUnix(dateString){

        //текущее время
        if(!dateString) return this.time;

        //проверка на корректность
        if(typeof dateString !== 'string' || dateString.length !== 10 || !dateString.match(/\d{2}-\d{2}-\d{4}/)){
            throw new Error(`Некорретное время: '${dateString}'. Укажите dd-mm-yyyy`);
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

module.exports = {Time, RandCode};
