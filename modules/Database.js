import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import Other from './Other.js';

const {WriteInLogFile} = Other;

// Включаем verbose-режим
sqlite3.verbose();

// Модуль для работы с базой данных
class Database {
    constructor(dbFilePath) {
        this.dbFilePath = dbFilePath;
        this.db = null;
    }

    async insert(tableName, params){
        return new Promise((resolve, reject) => {
            //значения полей для вствки
            const fields = Object.keys(params);
            const values = Object.values(params).map(value => {
                return clearSqlValue(value);
            });

            // Формирование запроса
            const sql = `INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${values.join(', ')})`;

            // Выполнение запроса
            this.executeNoDataReturning(sql, true).then(result => resolve(result)).catch(err => {
                reject(err);
            });
        });
    }

    // Обновление данных в таблице
    async update(tableName, update, condition){
        return new Promise((resolve, reject) => {

            // Значения для обновлений
            const updateParams = Object.keys(update).map(field => {
                const convertedValue = clearSqlValue(update[field]);
                return `${field} = ${convertedValue}`;
            });

            const conditionClause = buildSqlCondition(condition);

            // Формирование запроса
            const sql = `UPDATE ${tableName} SET ${updateParams.join(', ')}${conditionClause}`;

            // Выполнение запроса
            this.executeNoDataReturning(sql).then(result => resolve(result)).catch(err => reject(err));
        });
    }

    // Удаление записей из таблицы
    async delete(tableName, condition){
        return new Promise((resolve, reject) => {
  
            const conditionClause = buildSqlCondition(condition);
            
            // Формирование запроса
            const sql = `DELETE FROM ${tableName}${conditionClause}`;

            // Выполнение запроса
            this.executeNoDataReturning(sql).then(result => resolve(result)).catch(err => reject(err));
        });
    }

    async find(tableName, condition, limit, desc) {
        return new Promise((resolve, reject) => {
            
            const conditionClause = buildSqlCondition(condition, limit, desc);

            // Формирование запроса
            const sql = `SELECT * FROM ${tableName}${conditionClause}`;

            // Выполнение запроса
            this.executeWithReturning(sql).then(result => {
                // Если возвращать только одну запись
                if(limit && limit.toString() === 'true'){
                    resolve(result[0]);
                }

                resolve(result)

            // Обработка ошибок
            }).catch(err => reject(err));
        })
    }

    // Запрос без возвращаемого значения
    async executeNoDataReturning(sql, returnId = false) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, function(err) {
                if (err) return reject(new Error(`Не удалось выполнить запрос: ${err.message}`));
                resolve((returnId) ? this.lastID : undefined);
            });
        });
    }

    // Запрос с возвращаемым значением
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

                // Включение ограничений внешних ключей
                this.db.run('PRAGMA foreign_keys = ON', (err) => {
                    if (err) return reject(new Error(`Не удалось включить внешние ключи: ${err.message}`));
                });

                // Ооги и файл инициализации
                WriteInLogFile('База данных подключена⚡');
                const sqlFile = path.resolve(sqlFilePath);

                // Проверка на существование не пустой базы данных
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

//формирование условий для запроса
function buildSqlCondition(condition = [], limit, desc){

    //преобразование условия
    const operators = {
        exacly : '=',
        less : '<',
        more : '>',
        exaclyLess : '<=',
        exaclyMore : '>=',
        nonEqual: '!='
    }

    const orConditions = condition.map(orGroup => {
        return orGroup.map(andGroup => {
            //проверка на наличие названия поля
            if(typeof andGroup !== 'object' || !andGroup['field']) {
                throw new Error('Не указаны поля в условии');
            }

            //поиск названия оператора
            const fieldName = andGroup['field'];
            const operatorName = Object.keys(andGroup).find(operatorName => operators[operatorName]);

            //если оператор не найден, проверка, что условие является null
            if(!operatorName && Object.keys(andGroup).indexOf('isNull') + 1){
                return `${fieldName} ${andGroup.isNull.toString() === 'true' ? 'IS NULL' : 'IS NOT NULL'}`;
            }

            //проверка на наличие названия оператора
            if(!operatorName || andGroup[operatorName] === undefined){
                throw new Error('Не указано имя или значение оператора в условии');
            }

            //форматирование строки условия
            const value = andGroup[operatorName];
            const operator = operators[operatorName];
            const formatValue = clearSqlValue(value);

            //добавление условия
            return `${fieldName} ${operator} ${formatValue}`;

        }).join(' AND ')
    }).join(' OR ')


    let descClause = '', limitClause = '';

    //лимиты по выборке
    if (limit && (limit.toString() === 'true' || (!isNaN && limit > 0))){
        limitClause = ` LIMIT ${ limit.toString() === 'true' ? 1 : limit }`;
    }

    //порядок сортировки
    if(typeof desc === 'object'){
        const columnName = desc.byField ? ' ' + desc.byField : '';
        descClause = ` ORDER BY${columnName}${desc.decrease.toString() === 'true' ? ' DESC' : ' ASC'}`;
    }

    return `${orConditions ? ` WHERE ${orConditions}` : ''}${descClause}${limitClause}`;
}

//очистка строк вставки
function clearSqlValue(value){

    //обработка null
    if(value === null) return 'NULL'

    //обработка остальных значений
    return (isNaN(value))  ? `'${value.replace(/'/g, '\'\'')}'` : value;
}

export default Database;