const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const {WriteInLogFile} = require('./Other');

//модуль для работы с базой данных
class Database {
    constructor(dbFilePath) {
        this.dbFilePath = dbFilePath;
        this.db = null;
    }

    async insert(tableName, params){
        return new Promise((resolve, reject) => {
            //значения полей для вствки
            const fields = Object.keys(params);
            const values = Object.values(params).map(field => {
                if(typeof field === 'number') return field;
                else return `'${field}'`;
            });

            //формирование запроса
            const sql = `INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${values.join(', ')})`;

            // Выполнение запроса
            this.executeNoDataReturning(sql, true).then(result => resolve(result)).catch(err => {
                reject(err);
            });
        });
    }

    //обновление данных в таблице
    async update(tableName, update, condition){
        return new Promise((resolve, reject) => {

            //значения для обновлений
            const updateParams = Object.keys(update).map(field => {
                const convertedValue = typeof update[field] === 'number' ? update[field] : `'${update[field]}'`;
                return `${field} = ${convertedValue}`;
            });

            //значения условия
            const conditionParams = Object.keys(condition).map(field => {
                const convertedValue = typeof condition[field] === 'number' ? condition[field] : `'${condition[field]}'`;
                return `${field} = ${convertedValue}`;
            });

            //формирование запроса
            const sql = `UPDATE ${tableName} SET ${updateParams.join(', ')} WHERE ${conditionParams.join(' AND ')}`;

            // Выполнение запроса
            this.executeNoDataReturning(sql).then(result => resolve(result)).catch(err => reject(err));
        });
    }

    //удаление записей из таблицы
    async delete(tableName, condition){
        return new Promise((resolve, reject) => {
            //значения условия
            const conditionParams = Object.keys(condition).map(field => {
                const convertedValue = typeof condition[field] === 'number' ? condition[field] : `'${condition[field]}'`;
                return `${field} = ${convertedValue}`;
            });
            
            //формирование запроса
            const sql = `DELETE FROM ${tableName} WHERE ${conditionParams.join(' AND ')}`;

            // Выполнение запроса
            this.executeNoDataReturning(sql).then(result => resolve(result)).catch(err => reject(err));
        });
    }

    async find(tableName, params, limit, desc) {
        return new Promise((resolve, reject) => {

            const parameters = new Map([['!' , '!='], ['<' , '<'], ['>' , '>'], ['#', 'IS NULL'], ['*', 'IS NOT NULL']]);

            //значения полей для вствки
            const sqlParams = Object.keys(params).map(field => {
                  const rawValue = params[field].toString();
                  const param = parameters.get(rawValue.charAt(0));
                  if(param === 'IS NULL' || param === 'IS NOT NULL'){
                      return `${field} ${param}`;
                  }
            
                  const value = param ? rawValue.slice(1) : rawValue;
                  return `${field} ${param ? param : '='} ${isNaN(value) ? `'${value}'` : `${value}`}`;
            })
            
            //установка ограничения
            const limitClause = limit ? ` LIMIT ${Number(limit)}` : '';

            //сортировка
            let orderClause = '';

            //порядок сортировки
            if(typeof desc === 'string' && desc.length){
                isNegative = desc.charAt(0) === '!';
                const sortField = isNegative ? desc.slice(1) : desc;
                orderClause = ` ORDER BY ${sortField}${isNegative ? ' DESC' : ' ASC'}`;
            }
            
            //установка условия
            const condition = (sqlParams.length) ? ` WHERE ${sqlParams.join(' AND ')}` : '';
            
            //формирование запроса
            const sql = `SELECT * FROM ${tableName}${condition}${orderClause}${limitClause}`;

            // Выполнение запроса
            this.executeWithReturning(sql).then(result => {
                //если возвращать только одну запись
                if((typeof limit === 'boolean' && limit) || limit === 1){
                    result = result[0];
                }

                resolve(result)

            //обработка ошибок
            }).catch(err => reject(err));
        })
    }

    //запрос без возвращаемого значения
    async executeNoDataReturning(sql, returnId = false) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, function(err) {
                if (err) return reject(new Error(`Не удалось выполнить запрос: ${err.message}`));
                resolve((returnId) ? this.lastID : undefined);
            });
        });
    }

    //запрос с возвращаемым значением
    async executeWithReturning(sql) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, [], function(err, rows) {
                if (err) return reject(new Error(`Не удалось выполнить запрос: ${err.message}`));
                resolve(rows);
            });
        });
    }

    // Метод для инициализации базы данных
    connect(dbPath, sqlFilePath) {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbFilePath, (err) => {
                if (err) return reject(new Error(`Не удалось подключиться к базе данных: ${err.message}`));

                //включение ограничений внешних ключей
                this.db.run('PRAGMA foreign_keys = ON', (err) => {
                    if (err) return reject(new Error(`Не удалось включить внешние ключи: ${err.message}`));
                });

                //логи и файл инициализации
                WriteInLogFile('База данных подключена⚡');
                const sqlFile = path.resolve(sqlFilePath);

                //проверка на существование не пустой базы данных
                if(fs.statSync(dbPath).size > 0) {
                    WriteInLogFile('Инициазация не трубется 👌');
                    return resolve();
                }

                // Читаем SQL файл и выполняем его содержимое
                fs.readFile(sqlFile, 'utf8', (err, data) => {
                    if (err) return reject(new Error(`Не удалось считать SQL файл: ${err.message}`));

                    this.db.exec(data, (err) => {
                        if (err) return reject(new Error(`Не удалось выполнить SQL файл: ${err.message}`));
                        WriteInLogFile('База данных успешно инициализирована ✨');
                        resolve();
                    });
                });
            });
        });
    }

    // Закрытие базы данных
    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) throw new Error(`Ошибка при закрытии базы данных: ${err.message}`) 
                else WriteInLogFile('База данных закрыта. 👋👋👋');
            });
        }
    }
}

module.exports = Database;