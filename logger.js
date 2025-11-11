// logger.js - Winston logger for machine simulator
module.exports = function(mongoUri) {
    return constructor(mongoUri);
}

function constructor(mongoUri) {
    const winston = require('winston');
    require('winston-mongodb');
    require('winston-daily-rotate-file');
    const path = require('path');
    const fs = require('fs');

    // Ensure local logs directory exists
    const logsDir = path.join(__dirname, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    // Error file transport - keeps errors for 365 days
    let errorFileTransport = new winston.transports.DailyRotateFile({
        filename: path.join(logsDir, '%DATE%_error.log'),
        level: 'error',
        zippedArchive: true,
        maxFiles: '365d'
    });

    // Info file transport - keeps info logs for 30 days
    let infoFileTransport = new winston.transports.DailyRotateFile({
        filename: path.join(logsDir, '%DATE%_info.log'),
        level: 'info',
        zippedArchive: true,
        maxFiles: '30d'
    });

    // Create the logger with file transports
    const logger = winston.createLogger({
        levels: winston.config.npm.levels,
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        ),
        transports: [errorFileTransport, infoFileTransport],
        exceptionHandlers: [errorFileTransport],
        rejectionHandlers: [errorFileTransport]
    });

    // In non-production, add verbose logging
    if (process.env.NODE_ENV !== 'production') {
        logger.add(new winston.transports.DailyRotateFile({
            filename: path.join(logsDir, '%DATE%_everything.log'),
            level: 'silly',
            zippedArchive: true,
            maxFiles: '3d'
        }));
        logger.add(new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }));
    }

    // Add MongoDB transports if database is provided
    if (mongoUri) {
        logger.add(new winston.transports.MongoDB({
            level: 'error',
            db: mongoUri,
            collection: 'simulator-error',
            options: { useUnifiedTopology: true },
            storeHost: true,
            capped: false
        }));
        logger.add(new winston.transports.MongoDB({
            level: 'warn',
            db: mongoUri,
            collection: 'simulator-warn',
            options: { useUnifiedTopology: true },
            storeHost: true,
            capped: false
        }));
    }

    return logger;
}
