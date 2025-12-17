// logger.js - Winston logger for machine simulator
module.exports = function(logMongoUri) {
    return constructor(logMongoUri);
}

function constructor(logMongoUri) {
    const winston = require('winston');
    require('winston-mongodb');
    require('winston-daily-rotate-file');
    const path = require('path');
    const fs = require('fs');

    const isDevelopment = process.env.NODE_ENV === 'development';
    // Default to production mode unless explicitly in development
    // This means production mode is used whether NODE_ENV is set to 'production' or not set at all

    // Ensure local logs directory exists (only needed in dev)
    const logsDir = path.join(__dirname, 'logs');
    if (isDevelopment) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    // Create the logger with base configuration
    const logger = winston.createLogger({
        levels: winston.config.npm.levels,
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        ),
        transports: [],
        exceptionHandlers: [],
        rejectionHandlers: []
    });

    if (isDevelopment) {
        // ========== DEVELOPMENT MODE: Extensive Logging ==========
        // Only used when NODE_ENV is explicitly set to 'development'
        
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

        // Everything file transport - keeps all logs for 3 days
        let everythingFileTransport = new winston.transports.DailyRotateFile({
            filename: path.join(logsDir, '%DATE%_everything.log'),
            level: 'silly', // Log everything from silly level and above
            zippedArchive: true,
            maxFiles: '3d'
        });

        // Console transport with colorized output
        let consoleTransport = new winston.transports.Console({
            level: 'silly', // Show everything in console
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        });

        // Add all transports for development
        logger.add(errorFileTransport);
        logger.add(infoFileTransport);
        logger.add(everythingFileTransport);
        logger.add(consoleTransport);
        
        // Set exception and rejection handlers
        logger.exceptionHandlers = [errorFileTransport];
        logger.rejectionHandlers = [errorFileTransport];

        // Add MongoDB transports if database is provided
        if (logMongoUri) {
            // Log everything (all levels) to simulator-everything collection
            logger.add(new winston.transports.MongoDB({
                level: 'silly', // Log everything from silly level and above
                db: logMongoUri,
                collection: 'simulator-everything',
                options: { useUnifiedTopology: true },
                storeHost: true,
                capped: false
            }));
            // Log only errors to simulator-error collection
            logger.add(new winston.transports.MongoDB({
                level: 'error',
                db: logMongoUri,
                collection: 'simulator-error',
                options: { useUnifiedTopology: true },
                storeHost: true,
                capped: false
            }));
        }

    } else {
        // ========== PRODUCTION MODE: Minimal/Necessary Logging Only ==========
        // Default mode - used when NODE_ENV is not set, set to 'production', or any other value
        
        // Only log errors and warnings in production
        // No file logging in production (to reduce disk I/O)
        
        // Console transport - only errors and warnings
        let consoleTransport = new winston.transports.Console({
            level: 'warn', // Only warnings and errors
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json() // JSON format for production (easier to parse)
            )
        });

        logger.add(consoleTransport);
        
        // Set exception and rejection handlers
        logger.exceptionHandlers = [consoleTransport];
        logger.rejectionHandlers = [consoleTransport];

        // MongoDB transports - only errors in production
        if (logMongoUri) {
            // Log only errors to simulator-error collection
            logger.add(new winston.transports.MongoDB({
                level: 'error', // Only errors in production
                db: logMongoUri,
                collection: 'simulator-error',
                options: { useUnifiedTopology: true },
                storeHost: true,
                capped: false
            }));
        }
    }

    return logger;
}

