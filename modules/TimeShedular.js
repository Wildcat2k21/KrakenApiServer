import Other from './Other.js';

const {WriteInLogFile} = Other;

//планировщик задач
class TimeShedular{

    static tasks = [];

    //новая задача
    static NewTask(nameId, interval, callback){
        const task = {
            nameId,
            interval,
            callback
        }

        //установка интервала для задачи
        task.interval = setInterval(async () => {
            try{
                await task.callback();
            }
            catch(err){
                const error = err.message || err.response.data;
                WriteInLogFile(new Error(`Не выполнить задачу планировщика: ${error})`));
            }
        }, interval);

        TimeShedular.tasks.push(task);
    }

    //удаление задачи
    static RemoveTask(nameId){
        const currentTask = this.tasks.find(task => task.nameId === nameId);
        clearInterval(currentTask.interval);

        TimeShedular.tasks = TimeShedular.tasks.filter(task => task.nameId !== nameId);
    }
}

export default TimeShedular;